import { describe, expect, it } from "vitest";

import {
  LedgerCapabilityRequiredError,
  MemoryLedger,
  OrdariumRuntime,
  defineAction,
  defineSchema,
  effects,
  type LedgerCapabilities,
  type OperationLedger,
  type OperationRecord,
} from "../src/index.js";

const text = defineSchema<string>({ type: "string" }, (value) => {
  if (typeof value !== "string") throw new TypeError("expected string");
  return value;
});

const identity = { source: "test", scope: "capability", callId: "call-1" };
const allow = { decision: "allow", kind: "policy-decision", source: "test" } as const;

function guardedAction(executions: { count: number }) {
  return defineAction({
    name: "capability.guarded",
    version: "1",
    description: "Guarded side effect",
    input: text,
    output: text,
    effect: effects.guarded(),
    execute: (input) => {
      executions.count += 1;
      return `done:${input}`;
    },
  });
}

function readOnlyAction() {
  return defineAction({
    name: "capability.read",
    version: "1",
    description: "Read",
    input: text,
    output: text,
    effect: effects.readOnly(),
    execute: (input) => input,
  });
}

/** Delegating wrapper that lets a test fake a ledger's capability declaration. */
class LedgerWithCapabilities implements OperationLedger {
  readonly capabilities: LedgerCapabilities;
  readonly #inner: OperationLedger;

  constructor(inner: OperationLedger, capabilities: LedgerCapabilities) {
    this.#inner = inner;
    this.capabilities = capabilities;
  }

  get(operationId: string) {
    return this.#inner.get(operationId);
  }
  create(record: OperationRecord) {
    return this.#inner.create(record);
  }
  compareAndSet(operationId: string, expectedRevision: number, next: OperationRecord) {
    return this.#inner.compareAndSet(operationId, expectedRevision, next);
  }
  claim(
    operationId: string,
    expectedRevision: number,
    request: Parameters<OperationLedger["claim"]>[2],
    lease: Parameters<OperationLedger["claim"]>[3],
  ) {
    return this.#inner.claim(operationId, expectedRevision, request, lease);
  }
  lease(operationId: string) {
    return this.#inner.lease(operationId);
  }
  renewLease(operationId: string, owner: string, fencingToken: number, expiresAt: string) {
    return this.#inner.renewLease(operationId, owner, fencingToken, expiresAt);
  }
  history(operationId: string, cursor?: string, limit?: number) {
    return this.#inner.history(operationId, cursor, limit);
  }
  list(filter?: Parameters<OperationLedger["list"]>[0], cursor?: string) {
    return this.#inner.list(filter, cursor);
  }
}

const durableCaps = (coordination: LedgerCapabilities["coordination"]): LedgerCapabilities => ({
  durability: "crash-durable",
  coordination,
  semanticCas: true,
  liveLease: true,
  semanticHistory: true,
});

describe("ledger capability gate (G1-A10)", () => {
  it("fails a managed write on a volatile ledger before anything is persisted", async () => {
    const executions = { count: 0 };
    const action = guardedAction(executions);
    const ledger = new MemoryLedger();
    const runtime = new OrdariumRuntime({ ledger });

    await expect(
      action.run(runtime, "work", { identity, authorization: allow }),
    ).rejects.toBeInstanceOf(LedgerCapabilityRequiredError);
    await expect(
      action.run(runtime, "work", { identity, authorization: allow }),
    ).rejects.toMatchObject({ code: "LEDGER_CAPABILITY_REQUIRED" });

    expect((await ledger.list()).records).toHaveLength(0);
    expect(executions.count).toBe(0);
  });

  it("keeps read-only and explicit unmanaged actions legal on a volatile ledger", async () => {
    const runtime = new OrdariumRuntime({ ledger: new MemoryLedger() });
    await expect(runtime.run(readOnlyAction(), "work", { identity })).resolves.toBe("work");

    const unmanaged = defineAction({
      name: "capability.raw",
      version: "1",
      description: "Explicit unmanaged",
      input: text,
      output: text,
      effect: effects.unmanaged(),
      execute: (input) => input,
    });
    await expect(runtime.run(unmanaged, "work", { identity })).resolves.toBe("work");
  });

  it("honors the explicit volatile opt-in for embedded test and weak modes", async () => {
    const executions = { count: 0 };
    const action = guardedAction(executions);
    const runtime = new OrdariumRuntime({
      ledger: new MemoryLedger(),
      allowVolatileLedger: true,
    });

    await expect(action.run(runtime, "work", { identity, authorization: allow }))
      .resolves.toBe("done:work");
    expect(executions.count).toBe(1);
  });

  it("rejects a durable ledger whose coordination does not cover the declared deployment", async () => {
    const executions = { count: 0 };
    const action = guardedAction(executions);
    const narrowLedger = new LedgerWithCapabilities(new MemoryLedger(), durableCaps("single-isolate"));
    const runtime = new OrdariumRuntime({
      ledger: narrowLedger,
      deploymentCoordination: "local-multi-process",
    });

    await expect(action.run(runtime, "work", { identity, authorization: allow }))
      .rejects.toMatchObject({ code: "LEDGER_CAPABILITY_REQUIRED" });
    expect((await narrowLedger.list()).records).toHaveLength(0);
    expect(executions.count).toBe(0);

    const coveredRuntime = new OrdariumRuntime({ ledger: narrowLedger });
    await expect(action.run(coveredRuntime, "work", { identity, authorization: allow }))
      .resolves.toBe("done:work");
  });

  it("rejects a ledger without live lease or semantic history even when durable", async () => {
    const executions = { count: 0 };
    const action = guardedAction(executions);
    for (const patch of [
      { liveLease: false },
      { semanticHistory: false },
    ] as Partial<LedgerCapabilities>[]) {
      const ledger = new LedgerWithCapabilities(
        new MemoryLedger(),
        { ...durableCaps("local-multi-process"), ...patch } as LedgerCapabilities,
      );
      const runtime = new OrdariumRuntime({
        ledger,
        deploymentCoordination: "local-multi-process",
      });
      await expect(
        action.run(runtime, "work", { identity, authorization: allow }),
      ).rejects.toMatchObject({ code: "LEDGER_CAPABILITY_REQUIRED" });
    }
    expect(executions.count).toBe(0);
  });

  it("ledger implementations declare their capabilities honestly", () => {
    expect(new MemoryLedger().capabilities).toEqual({
      durability: "volatile",
      coordination: "single-isolate",
      semanticCas: true,
      liveLease: true,
      semanticHistory: true,
    });
    expect(new MemoryLedger().capabilities.durability).toBe("volatile");
  });
});
