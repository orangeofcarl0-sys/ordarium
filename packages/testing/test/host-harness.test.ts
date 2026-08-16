import { OrdariumRuntime, defineAction, defineSchema, effects } from "@ordarium/core";
import { describe, expect, it } from "vitest";

import { HostAdapterHarness } from "../src/index.js";

const text = defineSchema<string>({ type: "string" }, (value) => {
  if (typeof value !== "string") throw new TypeError("expected string");
  return value;
});

function guardedAction(name: string, executions: { count: number }) {
  return defineAction({
    name,
    version: "1",
    description: "Guarded side effect driven by the host harness",
    input: text,
    output: text,
    effect: effects.guarded(),
    execute: (input) => {
      executions.count += 1;
      return `done:${input}`;
    },
  });
}

const allow = { decision: "allow", source: "harness:policy" } as const;

describe("HostAdapterHarness", () => {
  it("converges a replayed host call onto one operation", async () => {
    const executions = { count: 0 };
    const action = guardedAction("harness.replay", executions);
    const runtime = new OrdariumRuntime();
    const harness = new HostAdapterHarness(runtime);

    await expect(
      harness.invoke(action, "work", { callId: "same", authorization: allow }),
    ).resolves.toBe("done:work");
    await expect(
      harness.invoke(action, "work", { callId: "same", authorization: allow }),
    ).resolves.toBe("done:work");

    expect(executions.count).toBe(1);
    expect(await runtime.ledger.list()).toHaveLength(1);
  });

  it("keeps sibling calls from the same root as separate operations", async () => {
    const executions = { count: 0 };
    const action = guardedAction("harness.siblings", executions);
    const runtime = new OrdariumRuntime();
    const harness = new HostAdapterHarness(runtime);

    await harness.invoke(action, "a", { callId: "A1", rootCallId: "R", authorization: allow });
    await harness.invoke(action, "b", { callId: "B1", rootCallId: "R", authorization: allow });

    expect(executions.count).toBe(2);
    expect(await runtime.ledger.list()).toHaveLength(2);
  });

  it("carries lineage and actor through the invocation for audit without affecting identity", async () => {
    const executions = { count: 0 };
    const action = guardedAction("harness.lineage", executions);
    const runtime = new OrdariumRuntime();
    const harness = new HostAdapterHarness(runtime);

    await harness.invoke(action, "a", {
      callId: "A1",
      rootCallId: "R",
      actor: "agent-1",
      lineage: ["root", "subagent-1"],
      authorization: allow,
    });
    const [record] = await runtime.ledger.list();

    expect(record?.identity).toMatchObject({
      source: "harness",
      rootCallId: "R",
      actor: "agent-1",
      lineage: ["root", "subagent-1"],
    });
  });
});
