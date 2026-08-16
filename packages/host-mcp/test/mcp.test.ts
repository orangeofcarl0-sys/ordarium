import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { OrdariumRuntime, defineAction, defineSchema, effects, type Action, type JsonValue } from "@ordarium/core";
import { SqliteLedger } from "@ordarium/ledger-sqlite";
import { asDshTool } from "@ordarium/dsh/advanced";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    // Windows releases child-held SQLite handles asynchronously; retry.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        rmSync(directory, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }
});

function freshDb(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), `ordarium-mcp-${prefix}-`));
  directories.push(directory);
  return join(directory, "operations.sqlite");
}

/** A protocol-level MCP stdio client driving the real server subprocess. */
function startServer(dbPath: string) {
  const fixture = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures", "mcp-server.mjs");
  const child = spawn(process.execPath, [fixture, dbPath], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  const pending = new Map<number, (value: Record<string, unknown>) => void>();
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    if (line.trim().length === 0) return;
    try {
      const message = JSON.parse(line) as { id?: number };
      if (typeof message.id === "number") pending.get(message.id)?.(message);
    } catch {
      // Ignore non-JSON noise on stdout.
    }
  });
  let nextId = 0;
  const call = (method: string, params?: unknown): Promise<Record<string, unknown>> => {
    const id = (nextId += 1);
    return new Promise((resolve, reject) => {
      pending.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      setTimeout(() => reject(new Error(`MCP call timed out: ${method}`)), 8_000).unref?.();
    });
  };
  const notify = (method: string) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
  };
  const stop = () => {
    child.stdin.end();
    child.kill();
    return new Promise<void>((resolve) => {
      const done = () => resolve();
      child.once("close", done);
      setTimeout(done, 2_000).unref?.();
    });
  };
  return { call, notify, stop };
}

async function handshake(client: ReturnType<typeof startServer>) {
  const init = await client.call("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "g5-client", version: "1.0.0" },
  });
  expect(init.result).toMatchObject({
    protocolVersion: "2024-11-05",
    serverInfo: { name: "ordarium" },
  });
  client.notify("notifications/initialized");
}

describe("@ordarium/host-mcp (G5-A09/A12)", () => {
  it("serves initialize, tools/list and tools/call over real stdio", async () => {
    const dbPath = freshDb("basic");
    const server = startServer(dbPath);
    try {
      await handshake(server);

      const list = await server.call("tools/list");
      const tools = (list.result as { tools: { name: string }[] }).tools.map((tool) => tool.name);
      expect(tools).toEqual(["demo.reserve-sku", "demo.echo", "demo.fail"]);
      expect(tools).not.toContain("ordarium_inspect"); // Ops tools stay unregistered by default.

      const echo = await server.call("tools/call", {
        name: "demo.echo",
        arguments: { value: "hello" },
      });
      expect(echo.result).toMatchObject({ isError: false });
      const text = (echo.result as { content: { type: string; text: string }[] }).content[0]!!;
      expect(text).toMatchObject({ type: "text", text: "\"hello\"" });
    } finally {
      await server.stop();
    }
  });

  it("deduplicates a replayed tool call onto one operation (A12)", async () => {
    const dbPath = freshDb("replay");
    const server = startServer(dbPath);
    try {
      await handshake(server);
      const first = await server.call("tools/call", {
        name: "demo.reserve-sku",
        arguments: { sku: "abc" },
      });
      // Same JSON-RPC id semantics are approximated by a second call with the
      // same business key: the ledger converges both onto one operation.
      const second = await server.call("tools/call", {
        name: "demo.reserve-sku",
        arguments: { sku: "abc" },
      });
      expect((first.result as { content: { text: string }[] }).content[0]!.text)
        .toBe((second.result as { content: { text: string }[] }).content[0]!.text);

      const ledger = new SqliteLedger(dbPath);
      const page = await ledger.list({ actionName: "demo.reserve-sku" });
      expect(page.records).toHaveLength(1);
      expect(page.records[0]).toMatchObject({
        state: "succeeded",
        attempts: 1,
        identity: { source: "mcp", scope: "g5-client" },
      });
      ledger.close();
    } finally {
      await server.stop();
    }
  });

  it("maps action failures to MCP error results without leaking details", async () => {
    const dbPath = freshDb("failure");
    const server = startServer(dbPath);
    try {
      await handshake(server);
      const failed = await server.call("tools/call", {
        name: "demo.fail",
        arguments: { value: "x" },
      });
      expect(failed.result).toMatchObject({ isError: true });
      const text = (failed.result as { content: { text: string }[] }).content[0]!.text;
      expect(text).toContain("OPERATION_UNCERTAIN");
      expect(text).not.toContain("exploded"); // raw provider errors never cross the boundary
    } finally {
      await server.stop();
    }
  });

  it("converges a business key across the DSH host and the MCP host (G5-A13)", async () => {
    const dbPath = freshDb("dual");
    const dshLedger = new SqliteLedger(dbPath);
    const dshRuntime = new OrdariumRuntime({
      ledger: dshLedger,
      deploymentCoordination: "local-multi-process",
    });
    const reserveInput = defineSchema(
      {
        type: "object",
        properties: { sku: { type: "string" } },
        required: ["sku"],
        additionalProperties: false,
      },
      (value) => {
        if (value === null || typeof value !== "object" || typeof (value as { sku?: unknown }).sku !== "string") {
          throw new TypeError("expected { sku: string }");
        }
        return value as { sku: string };
      },
    );
    const output = defineSchema({ type: "string" }, (value) => {
      if (typeof value !== "string") throw new TypeError("expected string");
      return value;
    });
    const sharedAction = defineAction({
      name: "demo.reserve-sku",
      version: "1",
      description: "Reserve one SKU exactly once across hosts",
      input: reserveInput,
      output,
      effect: effects.guarded(),
      key: (input) => `sku:${input.sku}`,
      execute: (input) => `reserved:${input.sku}`,
    });
    const plainAction = defineAction({
      name: "demo.echo",
      version: "1",
      description: "Echo the provided value",
      input: defineSchema(
        {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
          additionalProperties: false,
        },
        (value) => {
          if (value === null || typeof value !== "object" || typeof (value as { value?: unknown }).value !== "string") {
            throw new TypeError("expected { value: string }");
          }
          return value as { value: string };
        },
      ),
      output,
      effect: effects.guarded(),
      execute: (input) => input.value,
    });

    const tool = asDshTool(sharedAction, { runtime: dshRuntime });
    await tool.execute({ sku: "shared" }, {
      callId: "dsh-call-1",
      rootCallId: "dsh-root",
      name: "demo.reserve-sku",
      arguments: { sku: "shared" },
      signal: new AbortController().signal,
    });
    await asDshTool(plainAction, { runtime: dshRuntime }).execute({ value: "from-dsh" }, {
      callId: "dsh-call-2",
      rootCallId: "dsh-root",
      name: "demo.echo",
      arguments: { value: "from-dsh" },
      signal: new AbortController().signal,
    });

    const server = startServer(dbPath);
    try {
      await handshake(server);
      const converged = await server.call("tools/call", {
        name: "demo.reserve-sku",
        arguments: { sku: "shared" },
      });
      expect((converged.result as { content: { text: string }[] }).content[0]!.text)
        .toBe("\"reserved:shared\"");
      await server.call("tools/call", { name: "demo.echo", arguments: { value: "from-mcp" } });
    } finally {
      await server.stop();
    }

    const ledger = new SqliteLedger(dbPath);
    const reserved = await ledger.list({ actionName: "demo.reserve-sku" });
    expect(reserved.records).toHaveLength(1); // one business effect across both hosts
    expect(reserved.records[0]).toMatchObject({ state: "succeeded", attempts: 1 });

    const echoed = await ledger.list({ actionName: "demo.echo" });
    expect(echoed.records).toHaveLength(2); // separate identities never fold
    expect(new Set(echoed.records.map((record) => record.identity.source))).toEqual(new Set(["dsh", "mcp"]));
    ledger.close();
    await dshRuntime.dispose();
  });

  it("G9-A07: dispatches the opt-in ordarium_inspect tool with a sanitized view", async () => {
    const { createMcpOrdarium } = await import("../src/index.js");
    const ledger = new (await import("@ordarium/core")).MemoryLedger();
    const runtime = new OrdariumRuntime({ ledger, allowVolatileLedger: true });
    const echoInput = defineSchema(
      {
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"],
        additionalProperties: false,
      },
      (value) => {
        if (value === null || typeof value !== "object" || typeof (value as { value?: unknown }).value !== "string") {
          throw new TypeError("expected { value: string }");
        }
        return value as { value: string };
      },
    );
    const output = defineSchema({ type: "string" }, (value) => {
      if (typeof value !== "string") throw new TypeError("expected string");
      return value;
    });
    const action = defineAction({
      name: "demo.echo",
      version: "1",
      description: "Echo",
      input: echoInput,
      output,
      effect: effects.guarded(),
      execute: (input) => input.value,
    });

    const unauthorized = createMcpOrdarium({ runtime, actions: [action as never] });
    const listed = await unauthorized.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" }) as {
      result: { tools: { name: string }[] };
    };
    expect(listed.result.tools.some((tool) => tool.name === "ordarium_inspect")).toBe(false);

    const authorized = createMcpOrdarium({
      runtime,
      actions: [action as never],
      operations: {
        authorization: { operator: "op-1", source: "mcp:operator", grantedAt: "2026-01-01T00:00:00.000Z" },
      },
    });
    const listedAuthorized = await authorized.handle({ jsonrpc: "2.0", id: 2, method: "tools/list" }) as {
      result: { tools: { name: string }[] };
    };
    expect(listedAuthorized.result.tools.some((tool) => tool.name === "ordarium_inspect")).toBe(true);

    const answered = await authorized.handle({
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: "demo.echo", arguments: { value: "hi" } },
    }) as { result: { isError: boolean } };
    expect(answered.result.isError).toBe(false);
    const [record] = (await ledger.list()).records;

    const inspected = await authorized.handle({
      jsonrpc: "2.0", id: 4, method: "tools/call",
      params: { name: "ordarium_inspect", arguments: { operationId: record!.operationId } },
    }) as { result: { isError: boolean; content: { text: string }[] } };
    expect(inspected.result.isError).toBe(false);
    const payload = JSON.parse(inspected.result.content[0]!.text) as {
      found: boolean;
      view: Record<string, unknown>;
    };
    expect(payload.found).toBe(true);
    expect(Object.keys(payload.view).sort()).toEqual([
      "actionName", "actionVersion", "attempts", "effectKind",
      "operationId", "state", "updatedAt",
    ]);
    await unauthorized.stop();
    await authorized.stop();
  });

  it("keeps the kernel free of MCP types (A10/A12)", async () => {
    const core = await import("@ordarium/core");
    expect(Object.keys(core).some((name) => /mcp/iu.test(name))).toBe(false);
  });

  it("admits managed calls with host-admission evidence when no authorizer is wired", async () => {
    const { createMcpOrdarium } = await import("../src/index.js");
    const runtime = new OrdariumRuntime({ allowVolatileLedger: true });
    const echoInput = defineSchema(
      {
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"],
        additionalProperties: false,
      },
      (value) => {
        if (value === null || typeof value !== "object" || typeof (value as { value?: unknown }).value !== "string") {
          throw new TypeError("expected { value: string }");
        }
        return value as { value: string };
      },
    );
    const output = defineSchema({ type: "string" }, (value) => {
      if (typeof value !== "string") throw new TypeError("expected string");
      return value;
    });
    const server = createMcpOrdarium({
      runtime,
      actions: [defineAction({
        name: "demo.echo",
        version: "1",
        description: "Echo",
        input: echoInput,
        output,
        effect: effects.guarded(),
        execute: (input) => input.value,
      }) as unknown as Action<JsonValue, JsonValue>],
    });
    const response = await server.handle({
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "demo.echo", arguments: { value: "direct" } },
    }) as { result: { isError: boolean } };
    expect(response.result.isError).toBe(false);
    const [record] = (await runtime.ledger.list()).records;
    expect(record?.authorization).toMatchObject({
      kind: "host-admission",
      source: "mcp:tool-body-admitted",
    });
    expect(record?.identity).toMatchObject({ source: "mcp", scope: "mcp-client" });
    await server.stop();
  });
});
