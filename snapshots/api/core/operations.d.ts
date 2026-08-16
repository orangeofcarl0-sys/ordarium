import type { Action } from "./action.js";
import { type JsonValue } from "./json.js";
import type { OrdariumRuntime } from "./runtime.js";
import type { AuthorizationRecord, InvocationIdentity, OperationLedger, OperationListFilter, OperationRecord, OperationState, ProviderPrincipalRef, SafeError, UncertaintyRecord } from "./types.js";
/**
 * Independent operator permission boundary (G4 spec §4). It never reuses
 * Action authorization evidence and cannot be self-granted through tool
 * input - only a trusted host adapter constructs it.
 */
export interface OperatorAuthorization {
    readonly operator: string;
    readonly source: string;
    readonly grantedAt: string;
    readonly scope?: "operations" | "operations:reconcile" | undefined;
}
/** Audited operator view (G4 spec §2): full lineage and classified evidence. */
export interface OperationView {
    readonly operationId: string;
    readonly actionName: string;
    readonly actionVersion: string;
    readonly effectKind: OperationRecord["effectKind"];
    readonly idempotencyMode: OperationRecord["idempotencyMode"];
    readonly idempotencyExpiresAt?: string | undefined;
    readonly state: OperationState;
    readonly attempts: number;
    readonly semanticRevision: number;
    readonly lastFencingToken: number;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly identity: InvocationIdentity;
    readonly authorization?: AuthorizationRecord | undefined;
    readonly error?: SafeError | undefined;
    readonly uncertainty?: UncertaintyRecord | undefined;
    readonly receipt?: JsonValue | undefined;
    readonly resultRef?: {
        readonly digest: string;
    } | undefined;
}
/** Sanitized model view: no reason, actor, lineage, result or receipt bodies. */
export interface ModelOperationView {
    readonly operationId: string;
    readonly actionName: string;
    readonly actionVersion: string;
    readonly effectKind: OperationRecord["effectKind"];
    readonly state: OperationState;
    readonly attempts: number;
    readonly updatedAt: string;
    readonly reasonCode?: string | undefined;
}
export interface OperationViewPage {
    readonly views: readonly OperationView[];
    readonly nextCursor?: string | undefined;
}
export interface OperationEventView {
    readonly semanticRevision: number;
    readonly state: OperationState;
    readonly at: string;
    readonly view: OperationView;
}
export interface OperationEventViewPage {
    readonly events: readonly OperationEventView[];
    readonly nextCursor?: string | undefined;
}
export interface ReconcileOnlyRequest<I extends JsonValue, O extends JsonValue> {
    readonly operationId: string;
    readonly action: Action<I, O>;
    readonly input: unknown;
    readonly identity: InvocationIdentity;
    readonly authorization: OperatorAuthorization;
    readonly providerPrincipalRef?: ProviderPrincipalRef | undefined;
    readonly signal?: AbortSignal | undefined;
}
export interface OrdariumOperations {
    inspect(operationId: string, authorization: OperatorAuthorization): Promise<OperationView | undefined>;
    list(filter: OperationListFilter | undefined, cursor: string | undefined, authorization: OperatorAuthorization): Promise<OperationViewPage>;
    history(operationId: string, cursor: string | undefined, limit: number | undefined, authorization: OperatorAuthorization): Promise<OperationEventViewPage>;
    reconcileOnly<I extends JsonValue, O extends JsonValue>(request: ReconcileOnlyRequest<I, O>): Promise<O>;
}
export interface CreateOperationsOptions {
    /** Required for reconcileOnly; read paths work from a bare ledger. */
    readonly runtime?: OrdariumRuntime | undefined;
    readonly ledger?: OperationLedger | undefined;
}
/**
 * The Operations service stays in @ordarium/core (G4 spec §1): a thin,
 * audited read surface over the ledger plus a query-only disposal path that
 * wraps runtime.reconcileOnly. It has no execute, no force retry, no raw
 * SQL filter and no second recovery engine.
 */
export declare function createOperations(options?: CreateOperationsOptions): OrdariumOperations;
/** The model view is the same projector with a stricter field policy. */
export declare function projectModelView(record: OperationRecord): ModelOperationView;
//# sourceMappingURL=operations.d.ts.map