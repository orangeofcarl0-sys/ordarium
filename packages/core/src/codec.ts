import type { EffectProfile } from "./effects.js";
import { assertJsonValue, type JsonValue } from "./json.js";
import type {
  AuthorizationEvidenceKind,
  OperationRecord,
  OperationState,
} from "./types.js";

/**
 * The single complete OperationRecord codec owned by @ordarium/core
 * (docs/17 §9.2.5, G2 design spec §1). TypeScript shape, runtime decode,
 * length limits and cross-state invariants have exactly one source: this
 * module. Ledger implementations (memory, SQLite, custom) must decode
 * through it and never grow their own validators. Only schemaVersion 2 is
 * accepted; v1 shapes exist solely at the SQLite migration boundary.
 */
export const RESOURCE_LIMITS = Object.freeze({
  maxOperationIdLength: 64,
  maxActionNameLength: 128,
  maxActionVersionLength: 64,
  maxDigestLength: 64,
  maxIdentityFieldLength: 256,
  maxLineageEntries: 64,
  maxSourceLength: 256,
  maxReasonLength: 4_096,
  maxSafeErrorCodeLength: 128,
  maxSafeErrorMessageLength: 4_096,
  maxInputJsonBytes: 1_048_576,
});

const OPERATION_STATES = new Set<OperationState>([
  "proposed",
  "authorized",
  "denied",
  "claimed",
  "dispatched",
  "succeeded",
  "failed",
  "cancelled",
  "uncertain",
  "reconciled",
]);

const EFFECT_KINDS = new Set<EffectProfile["kind"]>([
  "read-only",
  "guarded",
  "idempotent",
  "reconcilable",
  "unmanaged",
]);

const IDEMPOTENCY_MODES = new Set<OperationRecord["idempotencyMode"]>(["none", "operation-key"]);

const EVIDENCE_KINDS = new Set<AuthorizationEvidenceKind>([
  "host-admission",
  "policy-decision",
  "human-approval",
]);

const HEX_64 = /^[0-9a-f]{64}$/u;
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]*$/u;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringField(container: Record<string, unknown>, key: string, maxLength: number): string {
  const value = container[key];
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new TypeError(`Operation record ${key} must be a string of 1 to ${maxLength} characters`);
  }
  return value;
}

function optionalStringField(
  container: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | undefined {
  return container[key] === undefined ? undefined : stringField(container, key, maxLength);
}

function integerField(container: Record<string, unknown>, key: string): number {
  const value = container[key];
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`Operation record ${key} must be a non-negative safe integer`);
  }
  return value as number;
}

function timestampField(container: Record<string, unknown>, key: string): string {
  const value = stringField(container, key, 64);
  if (!Number.isFinite(Date.parse(value))) {
    throw new TypeError(`Operation record ${key} must be a parseable timestamp`);
  }
  return value;
}

function optionalTimestampField(
  container: Record<string, unknown>,
  key: string,
): string | undefined {
  return container[key] === undefined ? undefined : timestampField(container, key);
}

function optionalJsonValue(container: Record<string, unknown>, key: string): JsonValue | undefined {
  const value = container[key];
  if (value === undefined) return undefined;
  assertJsonValue(value, `Operation record ${key}`);
  return value as JsonValue;
}

function optionalDigestField(
  container: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = container[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !HEX_64.test(value)) {
    throw new TypeError(`Operation record ${key} must be a lowercase 64-hex digest`);
  }
  return value;
}

function decodeIdentity(value: unknown): OperationRecord["identity"] {
  if (!isObject(value)) {
    throw new TypeError("Operation record identity must be an object");
  }
  const lineage = value.lineage;
  if (lineage !== undefined) {
    if (!Array.isArray(lineage) || lineage.length > RESOURCE_LIMITS.maxLineageEntries) {
      throw new TypeError(
        `Operation record identity lineage must be an array of at most ${RESOURCE_LIMITS.maxLineageEntries} entries`,
      );
    }
    for (const entry of lineage) {
      if (
        typeof entry !== "string" ||
        entry.length === 0 ||
        entry.length > RESOURCE_LIMITS.maxIdentityFieldLength
      ) {
        throw new TypeError("Operation record identity lineage entries must be non-empty bounded strings");
      }
    }
  }
  return {
    source: stringField(value, "source", RESOURCE_LIMITS.maxIdentityFieldLength),
    scope: stringField(value, "scope", RESOURCE_LIMITS.maxIdentityFieldLength),
    callId: stringField(value, "callId", RESOURCE_LIMITS.maxIdentityFieldLength),
    rootCallId: optionalStringField(value, "rootCallId", RESOURCE_LIMITS.maxIdentityFieldLength),
    actor: optionalStringField(value, "actor", RESOURCE_LIMITS.maxIdentityFieldLength),
    ...(lineage === undefined ? {} : { lineage: lineage as string[] }),
  };
}

function decodeAuthorization(value: unknown): NonNullable<OperationRecord["authorization"]> {
  if (!isObject(value)) {
    throw new TypeError("Operation record authorization must be an object");
  }
  const decision = value.decision;
  if (decision !== "allow" && decision !== "deny") {
    throw new TypeError("Operation record authorization decision must be allow or deny");
  }
  const kind = value.kind;
  if (typeof kind !== "string" || !EVIDENCE_KINDS.has(kind as AuthorizationEvidenceKind)) {
    throw new TypeError(
      "Operation record authorization kind must be host-admission, policy-decision or human-approval",
    );
  }
  return {
    decision,
    kind: kind as AuthorizationEvidenceKind,
    source: stringField(value, "source", RESOURCE_LIMITS.maxSourceLength),
    reason: optionalStringField(value, "reason", RESOURCE_LIMITS.maxReasonLength),
    at: timestampField(value, "at"),
  };
}

function decodeSafeError(value: unknown): NonNullable<OperationRecord["error"]> {
  if (!isObject(value)) {
    throw new TypeError("Operation record error must be an object");
  }
  const code = stringField(value, "code", RESOURCE_LIMITS.maxSafeErrorCodeLength);
  if (!SAFE_ERROR_CODE.test(code)) {
    throw new TypeError("Operation record error code must be an uppercase identifier");
  }
  const message = stringField(value, "message", RESOURCE_LIMITS.maxSafeErrorMessageLength);
  return { code, message };
}

function decodeClaim(value: unknown): NonNullable<OperationRecord["claim"]> {
  if (!isObject(value)) {
    throw new TypeError("Operation record claim must be an object");
  }
  const fencingToken = integerField(value, "fencingToken");
  if (fencingToken < 1) {
    throw new TypeError("Operation record claim fencingToken must be a positive safe integer");
  }
  const resumeFrom = value.resumeFrom;
  if (
    resumeFrom !== undefined &&
    !["authorized", "dispatched", "uncertain"].includes(String(resumeFrom))
  ) {
    throw new TypeError("Operation record claim resumeFrom must be authorized, dispatched or uncertain");
  }
  return {
    owner: stringField(value, "owner", RESOURCE_LIMITS.maxIdentityFieldLength),
    fencingToken,
    acquiredAt: timestampField(value, "acquiredAt"),
    ...(resumeFrom === undefined ? {} : { resumeFrom: resumeFrom as "authorized" | "dispatched" | "uncertain" }),
  };
}

function decodeUncertainty(value: Record<string, unknown>): NonNullable<OperationRecord["uncertainty"]> {
  return {
    reason: stringField(value, "reason", RESOURCE_LIMITS.maxReasonLength),
    at: timestampField(value, "at"),
  };
}

function decodeReconciliation(
  value: Record<string, unknown>,
): NonNullable<OperationRecord["reconciliation"]> {
  const outcome = value.outcome;
  if (outcome !== "succeeded" && outcome !== "failed") {
    throw new TypeError("Operation record reconciliation outcome must be succeeded or failed");
  }
  return { outcome, at: timestampField(value, "at") };
}

/**
 * Decode and fully validate an OperationRecord. Any nested field damage,
 * oversized metadata or violated cross-state invariant throws a TypeError,
 * so ledger reads fail closed before a Provider can be called on a corrupt
 * record (G1-A06).
 */
export function decodeOperationRecord(value: unknown): OperationRecord {
  if (!isObject(value)) {
    throw new TypeError("Operation record must be an object");
  }
  if (value.schemaVersion !== 2) {
    throw new TypeError("Unsupported Ordarium operation record schema");
  }

  const state = value.state;
  if (typeof state !== "string" || !OPERATION_STATES.has(state as OperationState)) {
    throw new TypeError("Invalid Ordarium operation state");
  }
  const effectKind = value.effectKind;
  if (typeof effectKind !== "string" || !EFFECT_KINDS.has(effectKind as EffectProfile["kind"])) {
    throw new TypeError("Invalid Ordarium effect kind");
  }
  const idempotencyMode = value.idempotencyMode;
  if (
    typeof idempotencyMode !== "string" ||
    !IDEMPOTENCY_MODES.has(idempotencyMode as OperationRecord["idempotencyMode"])
  ) {
    throw new TypeError("Invalid Ordarium idempotency mode");
  }
  for (const key of ["inputDigest", "logicalKeyDigest"] as const) {
    const digest = value[key];
    if (typeof digest !== "string" || !HEX_64.test(digest)) {
      throw new TypeError(`Operation record ${key} must be a lowercase 64-hex digest`);
    }
  }

  const claim = value.claim === undefined ? undefined : decodeClaim(value.claim);
  const uncertainty = value.uncertainty;
  if (uncertainty !== undefined) {
    if (!isObject(uncertainty)) {
      throw new TypeError("Operation record uncertainty must be an object");
    }
    decodeUncertainty(uncertainty);
  }
  const reconciliation = value.reconciliation;
  if (reconciliation !== undefined) {
    if (!isObject(reconciliation)) {
      throw new TypeError("Operation record reconciliation must be an object");
    }
    decodeReconciliation(reconciliation);
  }

  const record: OperationRecord = {
    schemaVersion: 2,
    operationId: stringField(value, "operationId", RESOURCE_LIMITS.maxOperationIdLength),
    actionName: stringField(value, "actionName", RESOURCE_LIMITS.maxActionNameLength),
    actionVersion: stringField(value, "actionVersion", RESOURCE_LIMITS.maxActionVersionLength),
    contractFingerprint: optionalDigestField(value, "contractFingerprint"),
    inputDigest: value.inputDigest as string,
    logicalKeyDigest: value.logicalKeyDigest as string,
    providerPrincipalDigest: optionalDigestField(value, "providerPrincipalDigest"),
    identity: decodeIdentity(value.identity),
    effectKind: effectKind as EffectProfile["kind"],
    idempotencyMode: idempotencyMode as OperationRecord["idempotencyMode"],
    idempotencyExpiresAt: optionalTimestampField(value, "idempotencyExpiresAt"),
    state: state as OperationState,
    semanticRevision: integerField(value, "semanticRevision"),
    attempts: integerField(value, "attempts"),
    lastFencingToken: integerField(value, "lastFencingToken"),
    authorization: value.authorization === undefined ? undefined : decodeAuthorization(value.authorization),
    ...(claim === undefined ? {} : { claim }),
    result: optionalJsonValue(value, "result"),
    receipt: optionalJsonValue(value, "receipt"),
    error: value.error === undefined ? undefined : decodeSafeError(value.error),
    ...(uncertainty === undefined ? {} : { uncertainty: decodeUncertainty(uncertainty) }),
    ...(reconciliation === undefined ? {} : { reconciliation: decodeReconciliation(reconciliation) }),
    createdAt: timestampField(value, "createdAt"),
    updatedAt: timestampField(value, "updatedAt"),
  };

  assertCrossStateInvariants(record);
  return record;
}

/**
 * The cross-state invariants every runtime-written record satisfies. A
 * record that violates them is treated as corruption, not as a state to
 * interpret.
 */
function assertCrossStateInvariants(record: OperationRecord): void {
  const { state } = record;
  const violation = (message: string): TypeError =>
    new TypeError(`Corrupt Ordarium operation record: ${message}`);

  if (record.semanticRevision === 0 && state !== "proposed") {
    throw violation("semantic revision 0 must still be proposed");
  }
  if (record.authorization !== undefined && state === "proposed") {
    throw violation("a proposed record cannot already hold authorization");
  }
  if (state === "authorized" && record.authorization?.decision !== "allow") {
    throw violation("an authorized record must hold an allow decision");
  }
  if (state === "denied" && record.authorization?.decision !== "deny") {
    throw violation("a denied record must hold a deny decision");
  }
  if (record.claim !== undefined && state !== "claimed" && state !== "dispatched") {
    throw violation("a semantic claim is only valid in the claimed or dispatched states");
  }
  if (record.claim !== undefined && record.claim.fencingToken !== record.lastFencingToken) {
    throw violation("the semantic claim must carry the latest fencing token");
  }
  if (record.claim?.resumeFrom !== undefined && state !== "claimed") {
    throw violation("claim.resumeFrom is only valid while claimed");
  }
  if (
    record.uncertainty !== undefined &&
    state !== "uncertain" &&
    !(state === "claimed" && record.claim?.resumeFrom === "uncertain")
  ) {
    throw violation("an uncertainty record is only valid while uncertain or recovering it");
  }
  if (state === "succeeded" && record.result === undefined) {
    throw violation("a succeeded record must hold a validated result");
  }
  if (state === "failed" && record.error === undefined) {
    throw violation("a failed record must hold a safe error");
  }
  if (state === "reconciled" && record.reconciliation === undefined) {
    throw violation("a reconciled record must hold its reconciliation outcome");
  }
  if (
    state === "reconciled" &&
    record.reconciliation?.outcome === "succeeded" &&
    record.result === undefined
  ) {
    throw violation("a reconciled success must hold the reconciled result");
  }
  if (
    state === "reconciled" &&
    record.reconciliation?.outcome === "failed" &&
    record.error === undefined
  ) {
    throw violation("a reconciled failure must hold its safe error");
  }
}
