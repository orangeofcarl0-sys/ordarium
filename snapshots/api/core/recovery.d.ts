import type { ReconcileResult } from "./action.js";
import type { OperationRecord } from "./types.js";
/**
 * The single recovery evidence evaluator (G3 spec §3). Normal invocation
 * recovery and Operations' reconcile-only share this module so there is
 * exactly one interpretation of the same evidence; reconcile-only can never
 * produce a redispatch decision.
 */
export type RecoveryMode = "normal" | "reconcile-only";
export type RecoveryDecision = {
    kind: "query";
} | {
    kind: "redispatch-same-key";
} | {
    kind: "stay-uncertain";
    reason: string;
};
export interface RecoveryEvidence {
    record: OperationRecord;
    hasReconcile: boolean;
    operationKeyUsable: boolean;
    mode: RecoveryMode;
    now: Date;
}
/** Path selection before any Provider call (docs/13 §5). */
export declare function evaluateRecovery(evidence: RecoveryEvidence): RecoveryDecision;
/**
 * The decision for the idempotent redispatch path: only normal mode, only
 * with a usable operation key, and only inside the frozen finite deadline.
 */
export declare function evaluateSameKeyRedispatch(record: OperationRecord, operationKeyUsable: boolean, mode: RecoveryMode, now: Date): RecoveryDecision;
/**
 * The decision after a reconcile query returned authoritative absence:
 * redispatch stays exclusive to normal mode inside the deadline
 * (G3-A11 / G4-A07: reconcile-only keeps uncertain, execute stays at zero).
 */
export declare function evaluateAuthoritativeAbsence(record: OperationRecord, outcome: Extract<ReconcileResult<never>, {
    status: "absent";
}>, mode: RecoveryMode, now: Date): RecoveryDecision;
/** A finite window's deadline is frozen at creation and never extended. */
export declare function idempotencyDeadlinePassed(record: OperationRecord, now: Date): boolean;
//# sourceMappingURL=recovery.d.ts.map