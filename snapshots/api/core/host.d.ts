import type { Action } from "./action.js";
import type { JsonValue } from "./json.js";
import { OrdariumError } from "./errors.js";
import type { AuthorizationDecision, InvocationIdentity, ProviderPrincipalRef } from "./types.js";
/**
 * Generation of the host-facing contract: the HostInvocationPort shape, port
 * semantics, host-visible error-family promises and host-side construction
 * defaults. Bumped only when one of those changes; each bump is recorded in
 * docs/13 and docs/18. Host adapters assert the version they were built
 * against — exact match, fail-closed. A tolerated mismatch would be a
 * compatibility layer, so none is provided.
 */
export declare const HOST_CONTRACT_VERSION = 1;
export declare class HostContractMismatchError extends OrdariumError {
    constructor(expected: number, actual: number);
}
export declare function assertHostContract(version: number): void;
/**
 * The frozen boundary a host adapter uses to enter @ordarium/core
 * (ARCH-3 decision 8). Hosts must provide stable invocation identity;
 * classified authorization evidence, the transient provider principal
 * reference and cancellation are optional. No host-specific types may
 * travel through this contract.
 */
export interface HostInvocation {
    readonly identity: InvocationIdentity;
    readonly authorization?: AuthorizationDecision | undefined;
    readonly providerPrincipalRef?: ProviderPrincipalRef | undefined;
    readonly signal?: AbortSignal | undefined;
}
/**
 * The only programmatic entry a host adapter may rely on. A conformant
 * host (DSH, MCP, or any other harness) maps its tool calls onto this
 * port; core owns the shape, adapters only consume it.
 */
export interface HostInvocationPort {
    invoke<I extends JsonValue, O extends JsonValue>(action: Action<I, O>, input: unknown, invocation: HostInvocation): Promise<O>;
}
//# sourceMappingURL=host.d.ts.map