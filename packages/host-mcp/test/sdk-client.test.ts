import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SqliteLedger } from "@ordarium/ledger-sqlite";
import { afterEach, describe, expect, it } from "vitest";

/**
 * G5 §5 item 2 closure: the official @modelcontextprotocol/sdk client
 * driving our stdio server end to end. The SDK is a devDependency of this
 * leaf package only - the server itself stays dependency-free.
 */

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
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

function freshDb(): string {
  const directory = mkdtempSync(join(tmpdir(), "ordarium-mcp-sdk-"));
  directories.push(directory);
  return join(directory, "operations.sqlite");
}

async function withSdkClient<T>(
  dbPath: string,
  run: (client: Client) => Promise<T>,
): Promise<T> {
  const fixture = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures", "mcp-server.mjs");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fixture, dbPath],
  });
  const client = new Client({ name: "ordarium-sdk-fixture", version: "1.0.0" });
  await client.connect(transport);
  try {
    return await run(client);
  } finally {
    await client.close();
  }
}

describe("official MCP SDK client against @ordarium/host-mcp", () => {
  it("lists tools and executes a guarded call with host-admission evidence", async () => {
    const dbPath = freshDb();
    await withSdkClient(dbPath, async (client) => {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual([
        "demo.reserve-sku",
        "demo.echo",
        "demo.fail",
      ]);

      const echoed = await client.callTool({ name: "demo.echo", arguments: { value: "sdk" } });
      expect(echoed.isError).toBeFalsy();
      expect((echoed.content as { type: string; text: string }[])[0]).toMatchObject({
        type: "text",
        text: "\"sdk\"",
      });
    });

    const ledger = new SqliteLedger(dbPath);
    const page = await ledger.list({ actionName: "demo.echo" });
    expect(page.records).toHaveLength(1);
    expect(page.records[0]).toMatchObject({
      state: "succeeded",
      identity: { source: "mcp", scope: "ordarium-sdk-fixture" },
      // The fixture server wires a policy authorizer; the default
      // host-admission path is asserted in-process in mcp.test.ts.
      authorization: { kind: "policy-decision", source: "g5-fixture:policy" },
    });
    ledger.close();
  });

  it("surfaces the honest uncertain of a failed guarded action as an error result", async () => {
    const dbPath = freshDb();
    await withSdkClient(dbPath, async (client) => {
      const failed = await client.callTool({ name: "demo.fail", arguments: { value: "x" } });
      expect(failed.isError).toBe(true);
      const text = (failed.content as { type: string; text: string }[])[0]!.text;
      expect(text).toContain("OPERATION_UNCERTAIN");
      expect(text).not.toContain("exploded");
    });
  });
});
