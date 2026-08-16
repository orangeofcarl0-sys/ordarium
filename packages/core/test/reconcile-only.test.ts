import { describe, expect, it } from "vitest";

import {
  MemoryLedger,
  OperationFailedError,
  OrdariumRuntime,
  SimulatedProcessCrash,
  UncertainOperationError,
  defineAction,
  defineSchema,
  effects,
  operationIdentityPreview,
  type OperationRecord,
  type ReconcileResult,
} from "../src/index.js";

const text = defineSchema<string>({ type: "string" }, (value) => {
  if (typeof value !== "string") throw new TypeError("expected string");
  return value;
});

const identity = { source: "test", scope: "reconcile-only", callId: "call-1" };
const allow = { decision: "allow", kind: "policy-decision", source: "test" } as const;
const LEASE_MS = 50;

/** Shared mutable clock so an operator can observe the crashed lease expiring. */
function sharedClock() {
  let clockMs = Date.parse("2026-01-01T00:00:00.000Z");
  return {
    clock: () => new Date(clockMs),
    expireLease: () => {
      clockMs += LEASE_MS * 10;
    },
  };
}

function runtimeOver(ledger: MemoryLedger, clock: () => Date): OrdariumRuntime {
  return new OrdariumRuntime({
    ledger,
    clock,
    leaseMs: LEASE_MS,
    allowVolatileLedger: true,
  });
}

describe("reconcileOnly entry (G3 spec §3, G3-A11)", () => {
  it("settles a crashed dispatch from the provider fact without executing again", async () => {
    const { clock, expireLease } = sharedClock();
    const ledger = new MemoryLedger({ clock });
    const executions = { count: 0 };
    const action = defineAction({
      name: "ronly.fact",
      version: "1",
      description: "Reconcilable fixture",
      input: text,
      output: text,
      effect: effects.reconcilable(),
      execute: (input) => {
        executions.count += 1;
        throw new SimulatedProcessCrash();
      },
      reconcile: (): ReconcileResult<string> => ({ status: "succeeded", value: "done:work" }),
    });

    const crashed = runtimeOver(ledger, clock);
    await expect(action.run(crashed, "work", { identity, authorization: allow }))
      .rejects.toMatchObject({ code: "SIMULATED_PROCESS_CRASH" });
    const executionsAfterCrash = executions.count;
    await crashed.dispose();

    expireLease();
    const operator = runtimeOver(ledger, clock);
    await expect(operator.reconcileOnly(action, "work", { identity }))
      .resolves.toBe("done:work");
    const [record] = (await ledger.list()).records;
    expect(record?.state).toBe("reconciled");
    expect(record?.reconciliation).toMatchObject({ outcome: "succeeded" });
    expect(executions.count).toBe(executionsAfterCrash); // execute spy stayed at zero.
    await operator.dispose();
  });

  it("keeps uncertain on authoritative absence even when retrySafe", async () => {
    const { clock, expireLease } = sharedClock();
    const ledger = new MemoryLedger({ clock });
    const executions = { count: 0 };
    const action = defineAction({
      name: "ronly.absent",
      version: "1",
      description: "Authoritative-absence fixture",
      input: text,
      output: text,
      effect: effects.reconcilable({ idempotencyWindow: { kind: "durable" } }),
      execute: (input) => {
        executions.count += 1;
        throw new SimulatedProcessCrash();
      },
      reconcile: (): ReconcileResult<string> => ({ status: "absent", retrySafe: true }),
    });

    const crashed = runtimeOver(ledger, clock);
    await expect(action.run(crashed, "work", { identity, authorization: allow }))
      .rejects.toMatchObject({ code: "SIMULATED_PROCESS_CRASH" });
    const executionsAfterCrash = executions.count;
    await crashed.dispose();

    expireLease();
    const operator = runtimeOver(ledger, clock);
    await expect(operator.reconcileOnly(action, "work", { identity }))
      .rejects.toBeInstanceOf(UncertainOperationError);
    const [record] = (await ledger.list()).records;
    expect(record?.state).toBe("uncertain");
    expect(executions.count).toBe(executionsAfterCrash); // Absence never triggers a dispatch here.
    await operator.dispose();
  });

  it("keeps uncertain for an operation-key action without any reconcile capability", async () => {
    const { clock, expireLease } = sharedClock();
    const ledger = new MemoryLedger({ clock });
    const executions = { count: 0 };
    const action = defineAction({
      name: "ronly.noquery",
      version: "1",
      description: "Idempotent fixture without reconcile",
      input: text,
      output: text,
      effect: effects.idempotent(),
      execute: (input) => {
        executions.count += 1;
        throw new SimulatedProcessCrash();
      },
    });

    const crashed = runtimeOver(ledger, clock);
    await expect(action.run(crashed, "work", { identity, authorization: allow }))
      .rejects.toMatchObject({ code: "SIMULATED_PROCESS_CRASH" });
    const executionsAfterCrash = executions.count;
    await crashed.dispose();

    expireLease();
    const operator = runtimeOver(ledger, clock);
    await expect(operator.reconcileOnly(action, "work", { identity }))
      .rejects.toBeInstanceOf(UncertainOperationError);
    const [record] = (await ledger.list()).records;
    expect(record?.state).toBe("uncertain");
    expect(record?.uncertainty?.reason).toBe("reconcile-only");
    expect(executions.count).toBe(executionsAfterCrash);
    await operator.dispose();
  });

  it("fails closed for an operation that was never dispatched", async () => {
    const { clock } = sharedClock();
    const ledger = new MemoryLedger({ clock });
    const action = defineAction({
      name: "ronly.predisp",
      version: "1",
      description: "Authorized-but-not-dispatched fixture",
      input: text,
      output: text,
      effect: effects.reconcilable(),
      execute: (input) => input,
      reconcile: (): ReconcileResult<string> => ({ status: "pending" }),
    });

    const preview = operationIdentityPreview(action, "work", identity);
    const now = new Date(clock()).toISOString();
    const record: OperationRecord = {
      schemaVersion: 2,
      operationId: preview.operationId,
      actionName: "ronly.predisp",
      actionVersion: "1",
      inputDigest: preview.inputDigest,
      logicalKeyDigest: preview.logicalKeyDigest,
      identity,
      effectKind: "reconcilable",
      idempotencyMode: "none",
      state: "authorized",
      semanticRevision: 1,
      attempts: 0,
      lastFencingToken: 0,
      authorization: { decision: "allow", kind: "policy-decision", source: "test", at: now },
      createdAt: now,
      updatedAt: now,
    } as OperationRecord;
    await ledger.create(record);

    const operator = runtimeOver(ledger, clock);
    await expect(operator.reconcileOnly(action, "work", { identity }))
      .rejects.toBeInstanceOf(OperationFailedError);
    const [stored] = (await ledger.list()).records;
    expect(stored?.state).toBe("authorized"); // Untouched: no claim, no query, no dispatch.
    await operator.dispose();
  });
});
