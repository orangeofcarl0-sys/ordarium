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
export declare class OrdariumRuntime implements ActionRunner, HostInvocationPort {
    #private;
    readonly ledger: OperationLedger;
    constructor(options?: OrdariumRuntimeOptions);
    run<I extends JsonValue, O extends JsonValue>(action: Action<I, O>, unknownInput: unknown, options?: ActionRunOptions): Promise<O>;
    invoke<I extends JsonValue, O extends JsonValue>(action: Action<I, O>, input: unknown, invocation: HostInvocation): Promise<O>;
    close(): Promise<void>;
}
export declare function operationIdentityPreview<I extends JsonValue, O extends JsonValue>(action: Action<I, O>, input: unknown, identity: InvocationIdentity): {
    operationId: string;
    inputDigest: string;
    logicalKeyDigest: string;
};
export declare function describeOperation(record: OperationRecord): string;
//# sourceMappingURL=runtime.d.ts.map