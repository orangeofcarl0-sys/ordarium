import type { Action, ActionRunOptions, ActionRunner } from "./action.js";
import { type JsonValue } from "./json.js";
import type { HostInvocation, HostInvocationPort } from "./host.js";
import type { AuthorizationDecision, InvocationIdentity, LedgerCoordination, OperationLedger, OperationRecord } from "./types.js";
export type RuntimeCheckpoint = "after-claim" | "after-dispatch" | "after-reconcile";
export interface RuntimeHooks {
    checkpoint?(name: RuntimeCheckpoint, record: OperationRecord): Promise<void> | void;
}
export interface AuthorizationRequest {
    action: {
        name: string;
        version: string;
        description: string;
        guarantee: string;
    };
    input: JsonValue;
    identity: InvocationIdentity;
    operationId: string;
}
export type Authorizer = (request: AuthorizationRequest) => Promise<AuthorizationDecision> | AuthorizationDecision;
export interface OrdariumRuntimeOptions {
    ledger?: OperationLedger | undefined;
    authorizer?: Authorizer | undefined;
    ownerId?: string | undefined;
    leaseMs?: number | undefined;
    clock?: (() => Date) | undefined;
    hooks?: RuntimeHooks | undefined;
    maxPersistedJsonBytes?: number | undefined;
    /**
     * Deployment topology the installation declares (docs/13 §6.1). Defaults
     * to "single-isolate" for direct core embedding; the managed DSH path
     * declares "local-multi-process".
     */
    deploymentCoordination?: LedgerCoordination | undefined;
    /**
     * Explicit weak-mode opt-in for tests and embedded deployments that
     * knowingly run managed writes on a volatile ledger. No crash or restart
     * guarantee is provided; production managed writes must fail closed
     * instead (G1-A10).
     */
    allowVolatileLedger?: boolean | undefined;
}
export type RuntimeLifecycleState = "accepting" | "quiescing" | "draining" | "closing" | "closed";
export declare class OrdariumRuntime implements ActionRunner, HostInvocationPort {
    #private;
    readonly ledger: OperationLedger;
    constructor(options?: OrdariumRuntimeOptions);
    /** Current lifecycle position (G3 spec §1); transitions are monotonic. */
    get lifecycle(): RuntimeLifecycleState;
    /**
     * Stop accepting new invocations. New runs fail closed with
     * RUNTIME_QUIESCING; in-flight work is untouched until dispose().
     */
    quiesce(): Promise<void>;
    /**
     * The one disposal path (G3 spec §2): quiesce -> bounded drain -> abort
     * remaining -> durable handoff -> absorb late callbacks -> close ledger.
     * The old unregister-then-close shortcut no longer exists.
     */
    dispose(options?: {
        drainMs?: number | undefined;
    }): Promise<void>;
    close(): Promise<void>;
    run<I extends JsonValue, O extends JsonValue>(action: Action<I, O>, unknownInput: unknown, options?: ActionRunOptions): Promise<O>;
    /**
     * Query-only recovery entry (G3 spec §3): the same evaluator and claim
     * machinery as a normal invocation, locked to reconcile-only mode. It can
     * never dispatch - not even on authoritative absence - so the Provider
     * execute spy stays at zero (G3-A11). G4's Operations wraps this method
     * instead of growing a second recovery engine.
     */
    reconcileOnly<I extends JsonValue, O extends JsonValue>(action: Action<I, O>, unknownInput: unknown, options?: ActionRunOptions): Promise<O>;
    invoke<I extends JsonValue, O extends JsonValue>(action: Action<I, O>, input: unknown, invocation: HostInvocation): Promise<O>;
}
export declare function operationIdentityPreview<I extends JsonValue, O extends JsonValue>(action: Action<I, O>, input: unknown, identity: InvocationIdentity): {
    operationId: string;
    inputDigest: string;
    logicalKeyDigest: string;
};
export declare function describeOperation(record: OperationRecord): string;
//# sourceMappingURL=runtime.d.ts.map