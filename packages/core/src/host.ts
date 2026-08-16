import type { Action } from "./action.js";
import type { JsonValue } from "./json.js";
import type {
  AuthorizationDecision,
  InvocationIdentity,
  ProviderPrincipalRef,
} from "./types.js";

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
  invoke<I extends JsonValue, O extends JsonValue>(
    action: Action<I, O>,
    input: unknown,
    invocation: HostInvocation,
  ): Promise<O>;
}
