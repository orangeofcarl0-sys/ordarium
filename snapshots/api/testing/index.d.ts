import { type Action, type AuthorizationDecision, type HostInvocationPort, type InvocationIdentity, type JsonValue, type OperationRecord, type ProviderPrincipalRef, type RuntimeCheckpoint, type RuntimeHooks } from "@ordarium/core";
export declare class FaultInjector implements RuntimeHooks {
    #private;
    crashAt(checkpoint: RuntimeCheckpoint, times?: number): this;
    checkpoint(name: RuntimeCheckpoint, record: OperationRecord): void;
}
export declare class ManualClock {
    #private;
    constructor(initial?: string);
    now: () => Date;
    advance(milliseconds: number): void;
}
export declare function fixedIdentity(overrides?: Partial<InvocationIdentity>): InvocationIdentity;
export interface HostHarnessCallOptions {
    callId?: string | undefined;
    rootCallId?: string | undefined;
    actor?: string | undefined;
    lineage?: string[] | undefined;
    authorization?: AuthorizationDecision | undefined;
    providerPrincipalRef?: ProviderPrincipalRef | undefined;
    signal?: AbortSignal | undefined;
}
export interface HostAdapterHarnessOptions {
    source?: string | undefined;
    scope?: string | undefined;
}
/**
 * Deterministic stand-in host that exercises the full HostInvocationPort
 * contract (stable identity, optional classified authorization, signal).
 * Used by the G1 host-adapter conformance suite and as the test base for
 * real adapters (DSH, host-mcp) in G5.
 */
export declare class HostAdapterHarness {
    #private;
    constructor(port: HostInvocationPort, options?: HostAdapterHarnessOptions);
    invoke<I extends JsonValue, O extends JsonValue>(action: Action<I, O>, input: unknown, options?: HostHarnessCallOptions): Promise<O>;
}
export * from "./provider.js";
//# sourceMappingURL=index.d.ts.map