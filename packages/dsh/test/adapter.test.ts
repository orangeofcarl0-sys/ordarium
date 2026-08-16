import { OrdariumRuntime, defineAction, defineSchema, effects, schema } from "@ordarium/core";
import { describe, expect, it } from "vitest";

import {
  asDshTool,
  registerActions,
  type DshToolDefinition,
  type DshToolRunContext,
} from "../src/advanced.js";

const stringSchema = defineSchema<string>({ type: "string" }, (value) => {
  if (typeof value !== "string") throw new TypeError("expected string");
  return value;
});
const inputSchema = schema.object({ value: schema.string() });

function context(callId = "call-1"): DshToolRunContext {
  return {
    callId,
    rootCallId: "root-1",
    name: "dsh.read",
    arguments: { value: "hello" },
    agent: { id: "agent-1", session: { id: "session-1" } },
    signal: new AbortController().signal,
  };
}

describe("DSH adapter", () => {
  it("emits the DSH ToolDefinition shape and maps a stable call identity", async () => {
    let calls = 0;
    const action = defineAction({
      name: "dsh.read",
      version: "1",
      description: "Read through DSH",
      input: inputSchema,
      output: stringSchema,
      effect: effects.readOnly(),
      execute(input) {
        calls += 1;
        return input.value.toUpperCase();
      },
    });
    const runtime = new OrdariumRuntime({ allowVolatileLedger: true });
    const tool = asDshTool(action, { runtime });

    expect(tool).toMatchObject({
      name: "dsh.read",
      description: "Read through DSH",
      parameters: { type: "object", required: ["value"] },
      output: { schema: { type: "string" } },
    });
    await expect(tool.execute({ value: "hello" }, context())).resolves.toBe("HELLO");
    await expect(tool.execute({ value: "hello" }, context())).resolves.toBe("HELLO");
    expect(calls).toBe(1);
    expect(tool.output.render({ value: "hello" }, "HELLO")).toEqual([{ type: "text", text: "HELLO" }]);
    const [record] = await runtime.ledger.list();
    expect(record?.identity).toMatchObject({
      source: "dsh",
      scope: "session-1",
      callId: "call-1",
      rootCallId: "root-1",
    });
  });

  it("records DSH tool-body admission without claiming human approval", async () => {
    const action = defineAction({
      name: "dsh.write",
      version: "1",
      description: "Write through DSH",
      input: inputSchema,
      output: stringSchema,
      effect: effects.guarded(),
      execute: (input) => input.value,
    });
    const runtime = new OrdariumRuntime({ allowVolatileLedger: true });

    await asDshTool(action, { runtime }).execute({ value: "hello" }, context("write-1"));
    const [record] = await runtime.ledger.list();
    expect(record?.authorization).toMatchObject({
      decision: "allow",
      kind: "host-admission",
      source: "dsh:tool-body-admitted",
    });
  });

  it("returns a disposer for registries that support unregistration", () => {
    const action = defineAction({
      name: "dsh.registered",
      version: "1",
      description: "Register through DSH",
      input: inputSchema,
      output: stringSchema,
      effect: effects.readOnly(),
      execute: (input) => input.value,
    });
    const registered: DshToolDefinition<any, any>[] = [];
    let disposed = false;
    const dispose = registerActions(
      {
        tools: {
          register(definition) {
            registered.push(definition);
            return () => {
              disposed = true;
            };
          },
        },
      },
      [action],
      { runtime: new OrdariumRuntime({ allowVolatileLedger: true }) },
    );

    expect(registered).toHaveLength(1);
    dispose();
    dispose();
    expect(disposed).toBe(true);
  });
});
