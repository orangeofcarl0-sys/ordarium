import { describe, expect, it } from "vitest";

import {
  IdempotencyExpiredError,
  MemoryLedger,
  OrdariumRuntime,
  SimulatedProcessCrash,
  UncertainOperationError,
  defineAction,
  defineSchema,
  effects,
  evaluateAuthoritativeAbsence,
  evaluateRecovery,
  idempotencyDeadlinePassed,
  type OperationRecord,
} from "../src/index.js";

const text = defineSchema<string>({ type: "string" }, (value) => {
  if (typeof value !== "string") throw new TypeError("expected string");
  return value;
});

const identity = { source: "test", scope: "recovery", callId: "call-1" };
const allow = { decision: "allow", kind: "policy-decision", source: "test" } as const;

function dispatchedRecord(overrides: Partial<OperationRecord> = {}): OperationRecord {
  return {
    schemaVersion: 2,
    operationId: `op_${"0".repeat(40)}`,
    actionName: "recovery.probe",
    actionVersion: "1",
    inputDigest: "a".repeat(64),
    logicalKeyDigest: "b".repeat(64),
    identity: { source: "test", scope: "recovery", callId: "call-1" },
    effectKind: "guarded",
    idempotencyMode: "none",
    state: "dispatched",
    semanticRevision: 3,
    attempts: 1,
    lastFencingToken: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:03.000Z",
    ...overrides,
  } as OperationRecord;
}

const now = new Date("2026-01-01T01:00:00.000Z");

describe("recovery evidence evaluator (G3 spec §3, G3-A11)", () => {
  it("prefers a query whenever the action implements reconcile(), in both modes", () => {
    for (const mode of ["normal", "reconcile-only"] as const) {
      expect(evaluateRecovery({
        record: dispatchedRecord(),
        hasReconcile: true,
        operationKeyUsable: true,
        mode,
        now,
      })).toEqual({ kind: "query" });
    }
  });

  it("keeps redispatch exclusive to normal mode inside the frozen deadline", () => {
    const base = { record: dispatchedRecord(), hasReconcile: false, operationKeyUsable: true, now };
    expect(evaluateRecovery({ ...base, mode: "normal" })).toEqual({ kind: "redispatch-same-key" });
    expect(evaluateRecovery({ ...base, mode: "reconcile-only" }))
      .toEqual({ kind: "stay-uncertain", reason: "reconcile-only" });
    expect(evaluateRecovery({ ...base, mode: "normal", operationKeyUsable: false }))
      .toEqual({ kind: "stay-uncertain", reason: "no-safe-recovery-path" });
  });

  it("refuses redispatch once the finite deadline has passed, in both modes", () => {
    const expired = dispatchedRecord({
      idempotencyMode: "operation-key",
      idempotencyExpiresAt: "2026-01-01T00:30:00.000Z",
    });
    expect(idempotencyDeadlinePassed(expired, now)).toBe(true);
    expect(evaluateRecovery({
      record: expired, hasReconcile: false, operationKeyUsable: true, mode: "normal", now,
    })).toEqual({ kind: "stay-uncertain", reason: "idempotency-expired" });

    const live = dispatchedRecord({
      idempotencyMode: "operation-key",
      idempotencyExpiresAt: "2026-01-01T02:00:00.000Z",
    });
    expect(idempotencyDeadlinePassed(live, now)).toBe(false);
  });

  it("maps authoritative absence to redispatch only in normal mode inside the deadline", () => {
    const live = dispatchedRecord({
      idempotencyMode: "operation-key",
      idempotencyExpiresAt: "2026-01-01T02:00:00.000Z",
    });
    expect(evaluateAuthoritativeAbsence(live, { status: "absent", retrySafe: true }, "normal", now))
      .toEqual({ kind: "redispatch-same-key" });
    expect(evaluateAuthoritativeAbsence(live, { status: "absent", retrySafe: true }, "reconcile-only", now))
      .toEqual({ kind: "stay-uncertain", reason: "reconcile-only" });
    expect(evaluateAuthoritativeAbsence(live, { status: "absent", retrySafe: false }, "normal", now))
      .toEqual({ kind: "stay-uncertain", reason: "reconcile-absent" });

    const expired = dispatchedRecord({
      idempotencyMode: "operation-key",
      idempotencyExpiresAt: "2026-01-01T00:30:00.000Z",
    });
    expect(evaluateAuthoritativeAbsence(expired, { status: "absent", retrySafe: true }, "normal", now))
      .toEqual({ kind: "stay-uncertain", reason: "idempotency-expired" });
  });
});

describe("finite deadline enforcement (G3 spec §4, G3-A05)", () => {
  function finiteIdempotentAction(executions: { count: number }, crash: boolean) {
    return defineAction({
      name: "recovery.finite",
      version: "1",
      description: "Finite idempotency fixture",
      input: text,
      output: text,
      effect: effects.idempotent({ window: { kind: "finite", expiresAfterMs: 3_600_000 } }),
      execute: (input) => {
        executions.count += 1;
        if (crash) throw new SimulatedProcessCrash();
        return `done:${input}`;
      },
    });
  }

  it("redispatches with the same key before the deadline after a crash, without extending it", async () => {
    const ledger = new MemoryLedger();
    let clockMs = Date.parse("2026-01-01T00:00:00.000Z");
    const clock = () => new Date(clockMs);
    const executions = { count: 0 };

    const first = new OrdariumRuntime({
      ledger,
      clock,
      allowVolatileLedger: true,
      hooks: { checkpoint: () => undefined },
    });
    await expect(
      finiteIdempotentAction(executions, true).run(first, "work", { identity, authorization: allow }),
    ).rejects.toMatchObject({ code: "SIMULATED_PROCESS_CRASH" });
    const [record] = (await ledger.list()).records;
    const frozenDeadline = record!.idempotencyExpiresAt;
    expect(frozenDeadline).toBe("2026-01-01T01:00:00.000Z");

    clockMs = Date.parse("2026-01-01T00:30:00.000Z"); // Restart well before the deadline.
    const second = new OrdariumRuntime({ ledger, clock, allowVolatileLedger: true });
    await expect(
      finiteIdempotentAction(executions, false).run(second, "work", { identity, authorization: allow }),
    ).resolves.toBe("done:work");
    expect(executions.count).toBe(2); // Same-key redispatch is one more attempt, one business effect per key contract.
    expect((await ledger.get(record!.operationId))?.idempotencyExpiresAt).toBe(frozenDeadline);
    await second.dispose();
  });

  it("refuses execution after the deadline and lands on an honest uncertain (IDEMPOTENCY_EXPIRED)", async () => {
    const ledger = new MemoryLedger();
    let clockMs = Date.parse("2026-01-01T00:00:00.000Z");
    const clock = () => new Date(clockMs);
    const executions = { count: 0 };

    const first = new OrdariumRuntime({ ledger, clock, allowVolatileLedger: true });
    await expect(
      finiteIdempotentAction(executions, true).run(first, "work", { identity, authorization: allow }),
    ).rejects.toMatchObject({ code: "SIMULATED_PROCESS_CRASH" });
    const [record] = (await ledger.list()).records;

    clockMs = Date.parse("2026-01-01T02:00:00.000Z"); // Past the frozen deadline.
    const second = new OrdariumRuntime({ ledger, clock, allowVolatileLedger: true });
    await expect(
      finiteIdempotentAction(executions, false).run(second, "work", { identity, authorization: allow }),
    ).rejects.toBeInstanceOf(IdempotencyExpiredError);
    await expect(
      finiteIdempotentAction(executions, false).run(second, "work", { identity, authorization: allow }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_EXPIRED" });

    const final = await ledger.get(record!.operationId);
    expect(final?.state).toBe("uncertain");
    expect(final?.uncertainty?.reason).toBe("idempotency-expired");
    expect(final?.idempotencyExpiresAt).toBe("2026-01-01T01:00:00.000Z");
    expect(executions.count).toBe(1); // The post-deadline recovery never executed.
    await second.dispose();
  });
});

describe("guarded recovery stays honest (regression)", () => {
  it("keeps an opaque dispatched operation uncertain without a blind retry", async () => {
    const ledger = new MemoryLedger();
    const executions = { count: 0 };
    const action = defineAction({
      name: "recovery.opaque",
      version: "1",
      description: "Opaque guarded fixture",
      input: text,
      output: text,
      effect: effects.guarded(),
      execute: (input) => {
        executions.count += 1;
        throw new SimulatedProcessCrash();
      },
    });

    const runtime = new OrdariumRuntime({ ledger, allowVolatileLedger: true });
    await expect(action.run(runtime, "work", { identity, authorization: allow }))
      .rejects.toMatchObject({ code: "SIMULATED_PROCESS_CRASH" });
    await expect(action.run(runtime, "work", { identity, authorization: allow }))
      .rejects.toBeInstanceOf(UncertainOperationError);
    expect(executions.count).toBe(1);
    await runtime.dispose();
  });
});
