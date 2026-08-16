import { describe, expect, it } from "vitest";

import {
  MemoryLedger,
  OperationConflictError,
  OperatorAuthorizationRequiredError,
  OperationFailedError,
  OrdariumRuntime,
  PrincipalConflictError,
  SimulatedProcessCrash,
  UncertainOperationError,
  createOperations,
  defineAction,
  defineSchema,
  effects,
  projectModelView,
  type InvocationIdentity,
  type OperationRecord,
  type OperatorAuthorization,
  type ReconcileResult,
} from "../src/index.js";

const text = defineSchema<string>({ type: "string" }, (value) => {
  if (typeof value !== "string") throw new TypeError("expected string");
  return value;
});

const identity: InvocationIdentity = {
  source: "dsh",
  scope: "session-1",
  callId: "call-1",
  rootCallId: "root-1",
  actor: "agent-1",
  lineage: ["root", "subagent-1"],
};
const allow = { decision: "allow", kind: "policy-decision", source: "test" } as const;
const reader: OperatorAuthorization = { operator: "op-1", source: "dsh:operator-command", grantedAt: "2026-01-01T00:00:00.000Z" };
const reconciler: OperatorAuthorization = { ...reader, scope: "operations:reconcile" };

const LEASE_MS = 50;

function fixture() {
  const clockMs = { value: Date.parse("2026-01-01T00:00:00.000Z") };
  const clock = () => new Date(clockMs.value);
  const ledger = new MemoryLedger({ clock });
  const runtime = new OrdariumRuntime({ ledger, clock, leaseMs: LEASE_MS, allowVolatileLedger: true });
  return {
    ledger,
    runtime,
    clock,
    /** An operator runtime sharing the ledger's clock, ready after lease expiry. */
    operatorRuntime: () =>
      new OrdariumRuntime({ ledger, clock, leaseMs: LEASE_MS, allowVolatileLedger: true }),
    expireLease: () => {
      clockMs.value += LEASE_MS * 10;
    },
  };
}

function reconcilableAction(executions: { count: number }, reconciles: { count: number }, outcome: () => ReconcileResult<string>) {
  return defineAction({
    name: "ops.reconcilable",
    version: "1",
    description: "Operations fixture",
    input: text,
    output: text,
    effect: effects.reconcilable(),
    execute: (input) => {
      executions.count += 1;
      throw new SimulatedProcessCrash();
    },
    reconcile: () => {
      reconciles.count += 1;
      return outcome();
    },
  });
}

/** Crash an invocation into an uncertain record, then hand over to an operator runtime. */
async function crashToUncertain(
  action: ReturnType<typeof reconcilableAction>,
  runtime: OrdariumRuntime,
): Promise<void> {
  await expect(action.run(runtime, "work", { identity, authorization: allow }))
    .rejects.toMatchObject({ code: "SIMULATED_PROCESS_CRASH" });
  await runtime.dispose();
}

describe("OrdariumOperations (G4)", () => {
  it("A01: inspects terminal and uncertain records without raw input", async () => {
    const { ledger, runtime } = fixture();
    const succeeded = defineAction({
      name: "ops.read",
      version: "1",
      description: "Read fixture",
      input: text,
      output: text,
      effect: effects.readOnly(),
      execute: (input) => input.toUpperCase(),
    });
    await succeeded.run(runtime, "work", { identity });
    const ops = createOperations({ runtime });

    const view = await ops.inspect((await ledger.list()).records[0]!.operationId, reader);
    expect(view).toMatchObject({ state: "succeeded", actionName: "ops.read", attempts: 1 });
    expect(view?.resultRef?.digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(view)).not.toContain("\"WORK\""); // result body never leaves the projector
    await runtime.dispose();
  });

  it("A02: paginates list and history through the frozen G2 cursors", async () => {
    const { ledger, runtime } = fixture();
    const ops = createOperations({ runtime });
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    for (let index = 0; index < 9; index += 1) {
      const updatedAt = new Date(base + index).toISOString();
      await ledger.create({
        schemaVersion: 2,
        operationId: `op_ops_${String(index).padStart(3, "0")}`,
        actionName: "ops.pages",
        actionVersion: "1",
        inputDigest: `${index}`.repeat(64).slice(0, 64),
        logicalKeyDigest: `${index + 1}`.repeat(64).slice(0, 64),
        identity: { source: "dsh", scope: "s", callId: `c${index}` },
        effectKind: "guarded",
        idempotencyMode: "none",
        state: "succeeded",
        semanticRevision: 1,
        attempts: 1,
        lastFencingToken: 1,
        result: index,
        createdAt: updatedAt,
        updatedAt,
      } as OperationRecord);
    }

    const seen: string[] = [];
    let cursor: string | undefined = undefined;
    do {
      const page = await ops.list({ limit: 4 }, cursor, reader);
      seen.push(...page.views.map((view) => view.operationId));
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    expect(seen).toHaveLength(9);
    expect(new Set(seen).size).toBe(9);

    const first = await ops.history("op_ops_000", undefined, 1, reader);
    expect(first.events).toHaveLength(1);
    expect(first.nextCursor).toBeUndefined();
    await runtime.dispose();
  });

  it("A03/A04: missing or mismatched recovery material fails closed with zero provider calls", async () => {
    const { ledger, runtime, operatorRuntime, expireLease } = fixture();
    const executions = { count: 0 };
    const reconciles = { count: 0 };
    const action = reconcilableAction(executions, reconciles, () => ({ status: "pending" }));
    await crashToUncertain(action, runtime);
    expireLease();
    const executionsAfterCrash = executions.count;

    const operator = createOperations({ runtime: operatorRuntime() });
    const operationId = (await ledger.list()).records[0]!.operationId;

    // Wrong input cannot reproduce the durable digests.
    await expect(operator.reconcileOnly({
      operationId, action, input: "guessed", identity, authorization: reconciler,
    })).rejects.toBeInstanceOf(OperationConflictError);
    // Wrong identity derives a different operation id.
    await expect(operator.reconcileOnly({
      operationId, action, input: "work",
      identity: { ...identity, callId: "other-call" },
      authorization: reconciler,
    })).rejects.toBeInstanceOf(OperationConflictError);
    // Unknown operation.
    await expect(operator.reconcileOnly({
      operationId: `op_${"0".repeat(40)}`, action, input: "work", identity, authorization: reconciler,
    })).rejects.toBeInstanceOf(OperationConflictError);
    // A drifted action version does not match either.
    const drifted = defineAction({
      name: "ops.reconcilable",
      version: "2",
      description: "Operations fixture",
      input: text,
      output: text,
      effect: effects.reconcilable(),
      execute: (input) => input,
      reconcile: () => ({ status: "pending" }) as ReconcileResult<string>,
    });
    await expect(operator.reconcileOnly({
      operationId, action: drifted, input: "work", identity, authorization: reconciler,
    })).rejects.toBeInstanceOf(OperationConflictError);

    expect(reconciles.count).toBe(0); // The provider query was never reached.
    expect(executions.count).toBe(executionsAfterCrash);
    // Inspect still works while recovery material is unavailable.
    await expect(operator.inspect(operationId, reader)).resolves.toMatchObject({ state: "dispatched" });
  });

  it("A05: reconcile outcomes settle audited terminal states through the codec", async () => {
    const { ledger, runtime, operatorRuntime, expireLease } = fixture();
    const executions = { count: 0 };
    const reconciles = { count: 0 };

    const successAction = reconcilableAction(executions, reconciles, () => ({ status: "succeeded", value: "done:work" }));
    await crashToUncertain(successAction, runtime);
    expireLease();
    const ops = createOperations({ runtime: operatorRuntime() });
    const operationId = (await ledger.list()).records[0]!.operationId;
    await expect(ops.reconcileOnly({
      operationId, action: successAction, input: "work", identity, authorization: reconciler,
    })).resolves.toBe("done:work");
    let view = await ops.inspect(operationId, reader);
    expect(view?.state).toBe("reconciled");
    expect(view?.resultRef?.digest).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("A05/A06: pending, unknown, throwing and invalid outcomes stay uncertain", async () => {
    const outcomes: [string, () => ReconcileResult<string>][] = [
      ["pending", () => ({ status: "pending" })],
      ["unknown", () => ({ status: "unknown" })],
      ["throwing", () => { throw new Error("query exploded"); }],
      ["invalid", () => ({ status: "succeeded", value: 42 as never })],
    ];
    for (const [label, outcome] of outcomes) {
      const { ledger, runtime, operatorRuntime, expireLease } = fixture();
      const action = reconcilableAction({ count: 0 }, { count: 0 }, outcome);
      await crashToUncertain(action, runtime);
      expireLease();
      const ops = createOperations({ runtime: operatorRuntime() });
      const operationId = (await ledger.list()).records[0]!.operationId;
      await expect(
        ops.reconcileOnly({ operationId, action, input: "work", identity, authorization: reconciler }),
        label,
      ).rejects.toBeInstanceOf(UncertainOperationError);
      expect(await ops.inspect(operationId, reader)).toMatchObject({ state: "uncertain" });
    }
  });

  it("A07: authoritative absence with retrySafe keeps uncertain and never executes", async () => {
    const { ledger, runtime, operatorRuntime, expireLease } = fixture();
    const executions = { count: 0 };
    const action = reconcilableAction(executions, { count: 0 }, () => ({ status: "absent", retrySafe: true }));
    await crashToUncertain(action, runtime);
    expireLease();
    const executionsAfterCrash = executions.count;

    const ops = createOperations({ runtime: operatorRuntime() });
    const operationId = (await ledger.list()).records[0]!.operationId;
    await expect(ops.reconcileOnly({
      operationId, action, input: "work", identity, authorization: reconciler,
    })).rejects.toBeInstanceOf(UncertainOperationError);
    expect(await ops.inspect(operationId, reader)).toMatchObject({ state: "uncertain" });
    expect(executions.count).toBe(executionsAfterCrash); // execute spy stayed at zero.
  });

  it("A08: a recovery credential for another principal is refused", async () => {
    const { ledger, runtime, operatorRuntime, expireLease } = fixture();
    const executions = { count: 0 };
    const action = reconcilableAction(executions, { count: 0 }, () => ({ status: "succeeded", value: "done:work" }));
    const principalA = { namespace: "tenant-1", subject: "user-a" };
    await expect(
      action.run(runtime, "work", { identity, authorization: allow, providerPrincipalRef: principalA }),
    ).rejects.toMatchObject({ code: "SIMULATED_PROCESS_CRASH" });
    await runtime.dispose();
    expireLease();

    const ops = createOperations({ runtime: operatorRuntime() });
    const operationId = (await ledger.list()).records[0]!.operationId;
    await expect(ops.reconcileOnly({
      operationId,
      action,
      input: "work",
      identity,
      authorization: reconciler,
      providerPrincipalRef: { namespace: "tenant-1", subject: "user-b" },
    })).rejects.toBeInstanceOf(PrincipalConflictError);
    expect(await ops.inspect(operationId, reader)).toMatchObject({ state: "dispatched" });
  });

  it("A09/A11: the model view hides operator-only fields; both share one projector", async () => {
    const { ledger, operatorRuntime } = fixture();
    const action = defineAction({
      name: "ops.opaque",
      version: "1",
      description: "Opaque failure fixture",
      input: text,
      output: text,
      effect: effects.guarded(),
      execute: (input) => {
        throw new Error(`lost the response for ${input}`);
      },
    });
    const runner = operatorRuntime();
    await expect(action.run(runner, "work", { identity, authorization: allow }))
      .rejects.toBeInstanceOf(UncertainOperationError);
    await runner.dispose();

    const record = (await ledger.list()).records[0]!;
    expect(record.state).toBe("uncertain");
    const model = projectModelView(record);
    expect(Object.keys(model).sort()).toEqual([
      "actionName",
      "actionVersion",
      "attempts",
      "effectKind",
      "operationId",
      "reasonCode",
      "state",
      "updatedAt",
    ]);
    expect(model.reasonCode).toBe(record.uncertainty?.reason);

    const ops = createOperations({ runtime: operatorRuntime() });
    const operatorView = await ops.inspect(record.operationId, reader);
    expect(operatorView?.identity).toMatchObject({
      source: "dsh",
      scope: "session-1",
      rootCallId: "root-1",
      actor: "agent-1",
      lineage: ["root", "subagent-1"],
    });
    expect(operatorView?.authorization).toMatchObject({ kind: "policy-decision" });
  });

  it("A10: unauthorized callers get nothing and cannot self-grant", async () => {
    const { ledger, runtime } = fixture();
    const ops = createOperations({ runtime });
    const operationId = (await ledger.list({ limit: 0 })).nextCursor; // empty ledger guard
    expect(operationId).toBeUndefined();

    await expect(ops.inspect(`op_${"0".repeat(40)}`, reader)).resolves.toBeUndefined();
    await expect(ops.inspect(`op_${"0".repeat(40)}`, { ...reader, operator: "" }))
      .rejects.toBeInstanceOf(OperatorAuthorizationRequiredError);
    await expect(ops.list(undefined, undefined, { ...reader, grantedAt: "not-a-date" }))
      .rejects.toMatchObject({ code: "OPERATOR_AUTHORIZATION_REQUIRED" });
    await expect(ops.list(undefined, undefined, { ...reader, scope: "operations:everything" } as unknown as OperatorAuthorization))
      .rejects.toBeInstanceOf(OperatorAuthorizationRequiredError);
    // A read-only grant cannot reconcile.
    const action = reconcilableAction({ count: 0 }, { count: 0 }, () => ({ status: "pending" }));
    await expect(ops.reconcileOnly({
      operationId: `op_${"0".repeat(40)}`, action, input: "work", identity, authorization: reader,
    })).rejects.toMatchObject({ code: "OPERATOR_AUTHORIZATION_REQUIRED" });
    await runtime.dispose();
  });

  it("reconcileOnly refuses records that were never dispatched", async () => {
    const { runtime } = fixture();
    const ops = createOperations({ runtime });
    const action = reconcilableAction({ count: 0 }, { count: 0 }, () => ({ status: "pending" }));
    await expect(ops.reconcileOnly({
      operationId: `op_${"0".repeat(40)}`, action, input: "work", identity, authorization: reconciler,
    })).rejects.satisfies((error: unknown) =>
      error instanceof OperationConflictError || error instanceof OperationFailedError);
    await runtime.dispose();
  });
});
