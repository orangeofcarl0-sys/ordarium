import { describe, expect, it } from "vitest";

import {
  MemoryLedger,
  OrdariumRuntime,
  RuntimeClosedError,
  RuntimeQuiescingError,
  UncertainOperationError,
  defineAction,
  defineSchema,
  effects,
} from "../src/index.js";

const text = defineSchema<string>({ type: "string" }, (value) => {
  if (typeof value !== "string") throw new TypeError("expected string");
  return value;
});

const identity = { source: "test", scope: "lifecycle", callId: "call-1" };
const allow = { decision: "allow", kind: "policy-decision", source: "test" } as const;

function guardedAction(
  name: string,
  execute: (input: string, context: { signal: AbortSignal }) => Promise<string>,
) {
  return defineAction({
    name,
    version: "1",
    description: "Lifecycle fixture action",
    input: text,
    output: text,
    effect: effects.guarded(),
    execute,
  });
}

describe("runtime lifecycle (G3 spec §1/§2, G3-A10)", () => {
  it("rejects new invocations with RUNTIME_QUIESCING after quiesce, before any operation exists", async () => {
    const ledger = new MemoryLedger();
    const runtime = new OrdariumRuntime({ ledger, allowVolatileLedger: true });
    const action = guardedAction("lifecycle.quiesce", async (input) => input);

    expect(runtime.lifecycle).toBe("accepting");
    await runtime.quiesce();
    expect(runtime.lifecycle).toBe("quiescing");

    await expect(action.run(runtime, "work", { identity, authorization: allow }))
      .rejects.toBeInstanceOf(RuntimeQuiescingError);
    await expect(action.run(runtime, "work", { identity, authorization: allow }))
      .rejects.toMatchObject({ code: "RUNTIME_QUIESCING" });
    expect((await ledger.list()).records).toHaveLength(0);

    await runtime.dispose();
    expect(runtime.lifecycle).toBe("closed");
  });

  it("drains in-flight work to its terminal state before closing", async () => {
    const ledger = new MemoryLedger();
    const runtime = new OrdariumRuntime({ ledger, allowVolatileLedger: true });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const action = guardedAction("lifecycle.drain", async (input) => {
      await held;
      return `done:${input}`;
    });

    const running = action.run(runtime, "work", { identity, authorization: allow });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const disposing = runtime.dispose({ drainMs: 5_000 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(runtime.lifecycle).toBe("draining");

    release();
    await expect(running).resolves.toBe("done:work");
    await disposing;
    expect(runtime.lifecycle).toBe("closed");

    const [record] = (await ledger.list()).records;
    expect(record?.state).toBe("succeeded");
    await expect(action.run(runtime, "work", { identity, authorization: allow }))
      .rejects.toBeInstanceOf(RuntimeClosedError);
  });

  it("hands a hung dispatched action off to uncertain and absorbs its late callback", async () => {
    const ledger = new MemoryLedger();
    const runtime = new OrdariumRuntime({ ledger, allowVolatileLedger: true });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const action = guardedAction("lifecycle.hung", async (input, context) => {
      await new Promise<void>((resolve) => {
        const stop = () => resolve();
        context.signal.addEventListener("abort", stop, { once: true });
      });
      await held; // Ignores the abort and keeps hanging.
      return `done:${input}`;
    });

    const running = action.run(runtime, "work", { identity, authorization: allow });
    await new Promise((resolve) => setTimeout(resolve, 25));

    await runtime.dispose({ drainMs: 40 });
    expect(runtime.lifecycle).toBe("closed");

    const [record] = (await ledger.list()).records;
    expect(record?.state).toBe("uncertain");
    expect(record?.uncertainty?.reason).toBe("runtime-dispose-handoff");
    expect(await ledger.lease(record!.operationId)).toBeUndefined();

    // The hung action eventually settles; its late callback must be absorbed
    // without an unhandled rejection and without changing durable state.
    release();
    await expect(running).rejects.toMatchObject({ code: "OPERATION_BUSY" });
    expect((await ledger.list()).records[0]?.state).toBe("uncertain");
  });

  it("hands a hung pre-dispatch invocation off to cancelled", async () => {
    const ledger = new MemoryLedger();
    const runtime = new OrdariumRuntime({
      ledger,
      allowVolatileLedger: true,
      authorizer: () =>
        new Promise(() => {
          // Authorizer hangs forever; the operation stays in proposed.
        }),
    });
    const action = guardedAction("lifecycle.predispatch", async (input) => input);

    const running = action.run(runtime, "work", { identity });
    void running.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 25));

    await runtime.dispose({ drainMs: 30 });
    expect(runtime.lifecycle).toBe("closed");

    const [record] = (await ledger.list()).records;
    expect(record?.state).toBe("cancelled");
  });

  it("leaves uncertain operations recoverable by a replacement runtime after handoff", async () => {
    const ledger = new MemoryLedger();
    const first = new OrdariumRuntime({ ledger, allowVolatileLedger: true });
    const action = guardedAction("lifecycle.recover", async (input, context) => {
      await new Promise<void>((resolve) => {
        context.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      throw new Error("aborted");
    });

    const running = action.run(first, "work", { identity, authorization: allow });
    await new Promise((resolve) => setTimeout(resolve, 25));
    await first.dispose({ drainMs: 30 });
    await expect(running).rejects.toBeInstanceOf(UncertainOperationError);

    const replacement = new OrdariumRuntime({ ledger, allowVolatileLedger: true });
    await expect(action.run(replacement, "work", { identity, authorization: allow }))
      .rejects.toBeInstanceOf(UncertainOperationError);
    const [record] = (await ledger.list()).records;
    expect(record?.state).toBe("uncertain");
    await replacement.dispose();
  });
});
