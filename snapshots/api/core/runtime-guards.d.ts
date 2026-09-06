/**
 * Module-private invocation guards extracted from the runtime module
 * (internal cohesion, 2026-09-07): pure validators and identity helpers
 * shared by the runtime pipeline and the identity-preview helper.
 * Package-internal only — these are not part of the public API surface
 * and are not re-exported from the package root.
 */
import type { Action } from "./action.js";
import { type JsonValue } from "./json.js";
import type { AuthorizationDecision, InvocationIdentity, ProviderPrincipalRef, SafeError } from "./types.js";
export declare function directIdentity<I extends JsonValue, O extends JsonValue>(action: Action<I, O>): InvocationIdentity;
export declare function principalDigestOf(ref: ProviderPrincipalRef): string;
export declare function assertProviderPrincipalRef(ref: ProviderPrincipalRef): void;
export declare function assertInvocationIdentity(identity: InvocationIdentity): void;
export declare function assertAuthorizationDecision(decision: AuthorizationDecision): void;
export declare function assertSafeError(error: SafeError): void;
//# sourceMappingURL=runtime-guards.d.ts.map