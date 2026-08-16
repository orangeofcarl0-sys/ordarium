import { describe, expect, it } from "vitest";

import {
  MemoryLedger,
  OperationCancelledError,
  OrdariumRuntime,
  UncertainOperationError,
  defineAction,
  defineSchema,
  effects,
} from "../src/index.js";

const text = defineSchema<string>({ type: "string" }, (value) => {
  if (typeof value !== "string") throw new TypeError("expected string");
  return value;
});

const identity = { source: "test", scope: "cancel", callId: "call-1" };
const allow = { decision: "allow", kind: "policy-decision", source: "test" } as const;

describe("cancellation semantics (G3 spec §3, G3-A08/A09)", () => {
  it("an abort before dispatch is provably cancelled with zero Provider calls", async () => {
    const ledger = new MemoryLedger();
    const executions = { count: 0 };
    const action = defineAction({
      name: "cancel.pre",
      version: "1",
      description: "Cancel before dispatch",
      input: text,
      output: text,
      effect: effects.guarded(),
      execute: (input) => {
        executions.count += 1;
        return input;
      },
    });
    const controller = new AbortController();
    controller.abort();
    const runtime = new OrdariumRuntime({ ledger, allowVolatileLedger: true });

    await expect(action.run(runtime, "work", { identity, authorization: allow, signal: controller.signal }))
      .rejects.toBeInstanceOf(OperationCancelledError);
    const [record] = (await ledger.list()).records;
    expect(record?.state).toBe("cancelled");
    expect(executions.count).toBe(0);
    await runtime.dispose();
  });

  it("an abort after dispatch lands on uncertain unless the Provider proves otherwise", async () => {
    const ledger = new MemoryLedger();
    const executions = { count: 0 };
    const action = defineAction({
      name: "cancel.post",
      version: "1",
      description: "Cancel after dispatch",
      input: text,
      output: text,
      effect: effects.guarded(),
      async execute(input, context) {
        executions.count += 1;
        await new Promise<void>((resolve) => {
          context.signal.addEventListener("abort", () => resolve(), { once: true });
        });
        // The provider call was interrupted: its outcome is unknown.
        throw new Error("request interrupted mid-flight");
      },
    });
    const controller = new AbortController();
    const runtime = new OrdariumRuntime({ ledger, allowVolatileLedger: true });

    const running = action.run(runtime, "work", { identity, authorization: allow, signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    await expect(running).rejects.toBeInstanceOf(UncertainOperationError);

    const [record] = (await ledger.list()).records;
    expect(record?.state).toBe("uncertain");
    expect(record?.uncertainty?.reason).toBe("cancel-requested-after-dispatch");
    expect(executions.count).toBe(1);
    await runtime.dispose();
  });
});
