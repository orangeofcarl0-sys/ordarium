import type { Action, ActionRunOptions, ActionRunner } from "./action.js";
import { type JsonValue } from "./json.js";
import type { HostInvocation, HostInvocationPort } from "./host.js";
import type { AuthorizationDecision, InvocationIdentity, OperationLedger, OperationRecord } from "./types.js";
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