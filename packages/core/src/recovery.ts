import type { ReconcileResult } from "./action.js";
import type { OperationRecord } from "./types.js";

/**
 * The single recovery evidence evaluator (G3 spec §3). Normal invocation
 * recovery and Operations' reconcile-only share this module so there is
 * exactly one interpretation of the same evidence; reconcile-only can never
 * produce a redispatch decision.
 */
export type RecoveryMode = "normal" | "reconcile-only";

export type RecoveryDecision =
  | { kind: "query" }
  | { kind: "redispatch-same-key" }
  | { kind: "stay-uncertain"; reason: string };

export interface RecoveryEvidence {
  record: OperationRecord;
  hasReconcile: boolean;
  operationKeyUsable: boolean;
  mode: RecoveryMode;
  now: Date;
}

/** Path selection before any Provider call (docs/13 §5). */
export function evaluateRecovery(evidence: RecoveryEvidence): RecoveryDecision {
  const { record, hasReconcile, operationKeyUsable, mode, now } = evidence;
  if (hasReconcile) return { kind: "query" };
  return evaluateSameKeyRedispatch(record, operationKeyUsable, mode, now);
}

/**
 * The decision for the idempotent redispatch path: only normal mode, only
 * with a usable operation key, and only inside the frozen finite deadline.
 */
export function evaluateSameKeyRedispatch(
  record: OperationRecord,
  operationKeyUsable: boolean,
  mode: RecoveryMode,
  now: Date,
): RecoveryDecision {
  if (!operationKeyUsable) return { kind: "stay-uncertain", reason: "no-safe-recovery-path" };
  if (mode === "reconcile-only") return { kind: "stay-uncertain", reason: "reconcile-only" };
  if (idempotencyDeadlinePassed(record, now)) {
    return { kind: "stay-uncertain", reason: "idempotency-expired" };
  }
  return { kind: "redispatch-same-key" };
}

/**
 * The decision after a reconcile query returned authoritative absence:
 * redispatch stays exclusive to normal mode inside the deadline
 * (G3-A11 / G4-A07: reconcile-only keeps uncertain, execute stays at zero).
 */
export function evaluateAuthoritativeAbsence(
  record: OperationRecord,
  outcome: Extract<ReconcileResult<never>, { status: "absent" }>,
  mode: RecoveryMode,
  now: Date,
): RecoveryDecision {
  if (!outcome.retrySafe) return { kind: "stay-uncertain", reason: "reconcile-absent" };
  return evaluateSameKeyRedispatch(record, true, mode, now);
}

/** A finite window's deadline is frozen at creation and never extended. */
export function idempotencyDeadlinePassed(record: OperationRecord, now: Date): boolean {
  return record.idempotencyExpiresAt !== undefined &&
    Date.parse(record.idempotencyExpiresAt) <= now.getTime();
}
