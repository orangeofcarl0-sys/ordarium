/**
 * Module-private invocation guards extracted from the runtime module
 * (internal cohesion, 2026-09-07): pure validators and identity helpers
 * shared by the runtime pipeline and the identity-preview helper.
 * Package-internal only — these are not part of the public API surface
 * and are not re-exported from the package root.
 */

import { randomUUID } from "node:crypto";

import type { Action } from "./action.js";
import { RESOURCE_LIMITS } from "./codec.js";
import { IdentityRequiredError } from "./errors.js";
import { digestJson, type JsonValue } from "./json.js";
import type {
  AuthorizationDecision,
  AuthorizationEvidenceKind,
  InvocationIdentity,
  ProviderPrincipalRef,
  SafeError,
} from "./types.js";

export function directIdentity<I extends JsonValue, O extends JsonValue>(
  action: Action<I, O>,
): InvocationIdentity {
  if (action.effect.kind === "read-only" || action.effect.kind === "unmanaged") {
    return { source: "direct", scope: "process", callId: randomUUID() };
  }
  throw new IdentityRequiredError();
}

export function principalDigestOf(ref: ProviderPrincipalRef): string {
  return digestJson({ namespace: ref.namespace, subject: ref.subject });
}

export function assertProviderPrincipalRef(ref: ProviderPrincipalRef): void {
  for (const [name, value] of [
    ["namespace", ref.namespace],
    ["subject", ref.subject],
  ] as const) {
    if (typeof value !== "string" || value.length === 0 || value.length > 256) {
      throw new TypeError(`Provider principal ${name} must be a string of 1 to 256 characters`);
    }
  }
}

const AUTHORIZATION_EVIDENCE_KINDS = new Set<AuthorizationEvidenceKind>([
  "host-admission",
  "policy-decision",
  "human-approval",
]);

export function assertInvocationIdentity(identity: InvocationIdentity): void {
  for (const [name, value] of [
    ["source", identity.source],
    ["scope", identity.scope],
    ["callId", identity.callId],
  ] as const) {
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.length > RESOURCE_LIMITS.maxIdentityFieldLength
    ) {
      throw new TypeError(
        `Invocation identity ${name} must be a string of 1 to ${RESOURCE_LIMITS.maxIdentityFieldLength} characters`,
      );
    }
  }
  if (
    identity.rootCallId !== undefined &&
    (identity.rootCallId.length === 0 || identity.rootCallId.length > RESOURCE_LIMITS.maxIdentityFieldLength)
  ) {
    throw new TypeError("Invocation identity rootCallId must be a non-empty bounded string");
  }
  if (
    identity.actor !== undefined &&
    (identity.actor.length === 0 || identity.actor.length > RESOURCE_LIMITS.maxIdentityFieldLength)
  ) {
    throw new TypeError("Invocation identity actor must be a non-empty bounded string");
  }
  if (identity.lineage !== undefined) {
    if (
      identity.lineage.length > RESOURCE_LIMITS.maxLineageEntries ||
      identity.lineage.some(
        (item) =>
          typeof item !== "string" ||
          item.length === 0 ||
          item.length > RESOURCE_LIMITS.maxIdentityFieldLength,
      )
    ) {
      throw new TypeError(
        `Invocation identity lineage must contain at most ${RESOURCE_LIMITS.maxLineageEntries} non-empty bounded strings`,
      );
    }
  }
}

export function assertAuthorizationDecision(decision: AuthorizationDecision): void {
  if (decision.decision !== "allow" && decision.decision !== "deny") {
    throw new TypeError("Authorization decision must be allow or deny");
  }
  if (
    typeof decision.kind !== "string" ||
    !AUTHORIZATION_EVIDENCE_KINDS.has(decision.kind as AuthorizationEvidenceKind)
  ) {
    throw new TypeError(
      "Authorization evidence kind must be host-admission, policy-decision or human-approval",
    );
  }
  if (typeof decision.source !== "string" || decision.source.length === 0) {
    throw new TypeError("Authorization decision source must be a non-empty string");
  }
  if (decision.reason !== undefined &&
    (typeof decision.reason !== "string" || decision.reason.length > 4_096)) {
    throw new TypeError("Authorization decision reason must be a string of at most 4096 characters");
  }
}

export function assertSafeError(error: SafeError): void {
  if (!/^[A-Z][A-Z0-9_]{0,127}$/u.test(error.code)) {
    throw new TypeError("Reconciliation error code must be a stable uppercase identifier");
  }
  if (typeof error.message !== "string" || error.message.length === 0 || error.message.length > 4_096) {
    throw new TypeError("Reconciliation error message must contain 1 to 4096 characters");
  }
}
