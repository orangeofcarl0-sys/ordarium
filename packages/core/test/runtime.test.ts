import { describe, expect, it } from "vitest";

import {
  AuthorizationRequiredError,
  MemoryLedger,
  OperationBusyError,
  OperationConflictError,
  OrdariumRuntime,
  PersistedValueTooLargeError,
  SimulatedProcessCrash,
  UncertainOperationError,
  defineAction,
  defineSchema,
  effects,
  schema,
  type InvocationIdentity,
} from "../src/index.js";

type Input = { value: string };
type Output = { accepted: string };

const inputSchema = defineSchema<Input>(
  {
    type: "object",
    properties: { value: { type: "string" } },
    required: ["value"],
    additionalProperties: false,
  },
  (value) => {
    if (value === null || typeof value !== "object" || typeof (value as Input).value !== "string") {
      throw new TypeError("input.value must be a string");
    }
    return { value: (value as Input).value };
  },
);

const outputSchema = defineSchema<Output>(
  {
    type: "object",
    properties: { accepted: { type: "string" } },
    required: ["accepted"],
    additionalProperties: false,
  },
  (value) => {
    if (value === null || typeof value !== "object" || typeof (value as Output).accepted !== "string") {
      throw new TypeError("output.accepted must be a string");
    }
    return { accepted: (value as Output).accepted };
  },
);

const identity: InvocationIdentity = {
  source: "test",
  scope: "runtime",
  callId: "call-1",
};

describe("OrdariumRuntime", () => {
  it("provides a zero-dependency schema builder for ordinary actions", () => {
    const built = schema.object({
      title: schema.string({ minLength: 1 }),
      count: schema.optional(schema.integer({ minimum: 0 })),
    });

    expect(built.parse({ title: "work", count: 2 })).toEqual({ title: "work", count: 2 });
    expect(built.parse({ title: "work" })).toEqual({ title: "work" });
    expect(() => built.parse({ title: "", extra: true })).toThrow();
    expect(built.jsonSchema).toMatchObject({
      type: "object",
      required: ["title"],
      additionalProperties: false,
    });
  });

  it("deduplicates one stable invocation and records the full transition history", async () => {
    let calls = 0;
    const action = defineAction({
      name: "example.read",
      version: "1",
      description: "Read an example",
      input: inputSchema,
      output: outputSchema,
      effect: effects.readOnly(),
      execute(input) {
        calls += 1;
        return { accepted: input.value };
      },
    });
    const ledger = new MemoryLedger();
    const runtime = new OrdariumRuntime({ ledger });

    await expect(action.run(runtime, { value: "a" }, { identity })).resolves.toEqual({ accepted: "a" });
    await expect(action.run(runtime, { value: "a" }, { identity })).resolves.toEqual({ accepted: "a" });

    expect(calls).toBe(1);
    const records = await ledger.list();
    expect(records).toHaveLength(1);
    await expect(ledger.history(records[0]!.operationId)).resolves.toMatchObject([
      { revision: 0, state: "proposed" },
      { revision: 1, state: "authorized" },
      { revision: 2, state: "claimed" },
      { revision: 3, state: "dispatched" },
      { revision: 4, state: "succeeded" },
    ]);
  });

  it("rejects reuse of an operation identity with different input", async () => {
    const action = defineAction({
      name: "example.conflict",
      version: "1",
      description: "Detect identity conflicts",
      input: inputSchema,
      output: outputSchema,
      effect: effects.readOnly(),
      execute: (input) => ({ accepted: input.value }),
    });
    const runtime = new OrdariumRuntime();

    await action.run(runtime, { value: "first" }, { identity });
    await expect(action.run(runtime, { value: "second" }, { identity }))
      .rejects.toBeInstanceOf(OperationConflictError);
  });

  it("renews a live claim so a second runtime cannot steal a long action", async () => {
    const ledger = new MemoryLedger();
    let calls = 0;
    let started!: () => void;
    const didStart = new Promise<void>((resolve) => {
      started = resolve;
    });
    const action = defineAction({
      name: "example.long-read",
      version: "1",
      description: "Keep a claim alive while work is active",
      input: inputSchema,
      output: outputSchema,
      effect: effects.readOnly(),
      async execute(input) {
        calls += 1;
        started();
        await new Promise((resolve) => setTimeout(resolve, 120));
        return { accepted: input.value };
      },
    });
    const firstRuntime = new OrdariumRuntime({ ledger, ownerId: "first", leaseMs: 30 });
    const secondRuntime = new OrdariumRuntime({ ledger, ownerId: "second", leaseMs: 30 });

    const first = action.run(firstRuntime, { value: "held" }, { identity });
    await didStart;
    await new Promise((resolve) => setTimeout(resolve, 70));
    await expect(action.run(secondRuntime, { value: "held" }, { identity }))
      .rejects.toBeInstanceOf(OperationBusyError);
    await expect(first).resolves.toEqual({ accepted: "held" });
    expect(calls).toBe(1);
    const [record] = await ledger.list();
    expect(record!.revision).toBeGreaterThan(4);
  });

  it("fails closed when a managed side effect has no authorization source", async () => {
    const action = defineAction({
      name: "example.guarded",
      version: "1",
      description: "Guard a write",
      input: inputSchema,
      output: outputSchema,
      effect: effects.guarded(),
      execute: (input) => ({ accepted: input.value }),
    });

    await expect(action.run(new OrdariumRuntime(), { value: "x" }, { identity }))
      .rejects.toBeInstanceOf(AuthorizationRequiredError);
  });

  it("bounds persisted JSON before committing a terminal result", async () => {
    const action = defineAction({
      name: "example.large-result",
      version: "1",
      description: "Reject an oversized durable result",
      input: inputSchema,
      output: outputSchema,
      effect: effects.readOnly(),
      execute: () => ({ accepted: "this result is intentionally too large" }),
    });
    const runtime = new OrdariumRuntime({ maxPersistedJsonBytes: 16 });

    await expect(action.run(runtime, { value: "x" }, { identity }))
      .rejects.toBeInstanceOf(PersistedValueTooLargeError);
    const [record] = await runtime.ledger.list();
    expect(record?.state).toBe("failed");
    expect(record?.result).toBeUndefined();
  });

  it("never blindly retries an opaque side effect after dispatch", async () => {
    let calls = 0;
    const action = defineAction({
      name: "example.opaque-write",
      version: "1",
      description: "Write without a provider recovery primitive",
      input: inputSchema,
      output: outputSchema,
      effect: effects.guarded(),
      execute() {
        calls += 1;
        throw new Error("transport disconnected");
      },
    });
    const runtime = new OrdariumRuntime();
    const options = {
      identity,
      authorization: { decision: "allow" as const, source: "test" },
    };

    await expect(action.run(runtime, { value: "x" }, options))
      .rejects.toBeInstanceOf(UncertainOperationError);
    await expect(action.run(runtime, { value: "x" }, options))
      .rejects.toBeInstanceOf(UncertainOperationError);
    expect(calls).toBe(1);
  });

  it("reuses one provider idempotency key after a crash without duplicating the effect", async () => {
    const remote = new Map<string, Output>();
    let providerCalls = 0;
    let crash = true;
    const action = defineAction({
      name: "example.idempotent-write",
      version: "1",
      description: "Write through a provider idempotency key",
      input: inputSchema,
      output: outputSchema,
      effect: effects.idempotent(),
      execute(input, context) {
        providerCalls += 1;
        const value = remote.get(context.idempotencyKey) ?? { accepted: input.value };
        remote.set(context.idempotencyKey, value);
        if (crash) {
          crash = false;
          throw new SimulatedProcessCrash(context.operationId);
        }
        return value;
      },
    });
    const runtime = new OrdariumRuntime();
    const options = {
      identity,
      authorization: { decision: "allow" as const, source: "test" },
    };

    await expect(action.run(runtime, { value: "once" }, options))
      .rejects.toBeInstanceOf(SimulatedProcessCrash);
    await expect(action.run(runtime, { value: "once" }, options))
      .resolves.toEqual({ accepted: "once" });
    expect(providerCalls).toBe(2);
    expect(remote).toHaveLength(1);
  });

  it("reconciles an externally successful operation after a crash", async () => {
    const remote = new Map<string, Output>();
    let executeCalls = 0;
    const action = defineAction({
      name: "example.reconcilable-write",
      version: "1",
      description: "Reconcile a remote write",
      input: inputSchema,
      output: outputSchema,
      effect: effects.reconcilable(),
      execute(input, context) {
        executeCalls += 1;
        remote.set(context.operationId, { accepted: input.value });
        throw new SimulatedProcessCrash(context.operationId);
      },
      reconcile(_input, context) {
        const value = remote.get(context.operationId);
        return value === undefined
          ? { status: "absent", retrySafe: true }
          : { status: "succeeded", value, receipt: { provider: "example" } };
      },
    });
    const runtime = new OrdariumRuntime();
    const options = {
      identity,
      authorization: { decision: "allow" as const, source: "test" },
    };

    await expect(action.run(runtime, { value: "done" }, options))
      .rejects.toBeInstanceOf(SimulatedProcessCrash);
    await expect(action.run(runtime, { value: "done" }, options))
      .resolves.toEqual({ accepted: "done" });
    expect(executeCalls).toBe(1);
    const [record] = await runtime.ledger.list();
    expect(record).toMatchObject({
      state: "reconciled",
      reconciliation: { outcome: "succeeded" },
      receipt: { provider: "example" },
    });
  });
});
