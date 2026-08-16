import type { GuaranteeLevel } from "./effects.js";
import type { JsonValue } from "./json.js";
export type OperationState = "proposed" | "authorized" | "denied" | "claimed" | "dispatched" | "succeeded" | "failed" | "cancelled" | "uncertain" | "reconciled";
export interface InvocationIdentity {
    source: string;
    scope: string;
    callId: string;
    rootCallId?: string | undefined;
    actor?: string | undefined;
    lineage?: string[] | undefined;
}
/**
 * Transient reference to the Provider principal a credential resolves to.
 * It lives in memory only; records persist at most its canonical digest,
 * which acts as a continuity conflict field for the same operation
 * (docs/13 §2): recovery must resolve to the same principal or fail closed.
 */
export interface ProviderPrincipalRef {
    readonly namespace: string;
    readonly subject: string;
}
export type AuthorizationEvidenceKind = "host-admission" | "policy-decision" | "human-approval";
export interface AuthorizationDecision {
    decision: "allow" | "deny";
    kind: AuthorizationEvidenceKind;
    source: string;
    reason?: string | undefined;
}
export interface AuthorizationRecord extends AuthorizationDecision {
    at: string;
}
export interface OperationClaim {
    owner: string;
    expiresAt: string;
    fencingToken: number;
}
export interface SafeError {
    code: string;
    message: string;
}
export interface UncertaintyRecord {
    reason: string;
    at: string;
}
export interface ReconciliationRecord {
    outcome: "failed" | "succeeded";
    at: string;
}
export interface OperationRecord {
    schemaVersion: 1;
    operationId: string;
    actionName: string;
    actionVersion: string;
    inputDigest: string;
    logicalKeyDigest: string;
    identity: InvocationIdentity;
    guarantee: GuaranteeLevel;
    state: OperationState;
    revision: number;
    attempts: number;
    lastFencingToken: number;
    createdAt: string;
    updatedAt: string;
    authorization?: AuthorizationRecord | undefined;
    providerPrincipalDigest?: string | undefined;
    claim?: OperationClaim | undefined;
    resumeFrom?: "authorized" | "dispatched" | "uncertain" | undefined;
    result?: JsonValue | undefined;
    receipt?: JsonValue | undefined;
    error?: SafeError | undefined;
    uncertainty?: UncertaintyRecord | undefined;
    reconciliation?: ReconciliationRecord | undefined;
}
export interface OperationEvent {
    operationId: string;
    revision: number;
    state: OperationState;
    at: string;
    record: OperationRecord;
}
export interface OperationListFilter {
    actionName?: string | undefined;
    state?: OperationState | undefined;
    limit?: number | undefined;
}
export interface OperationLedger {
    get(operationId: string): Promise<OperationRecord | undefined>;
    create(record: OperationRecord): Promise<{
        created: boolean;
        record: OperationRecord;
    }>;
    compareAndSet(operationId: string, expectedRevision: number, next: OperationRecord): Promise<boolean>;
    history(operationId: string): Promise<OperationEvent[]>;
    list(filter?: OperationListFilter): Promise<OperationRecord[]>;
    close?(): Promise<void> | void;
}
//# sourceMappingURL=types.d.ts.map