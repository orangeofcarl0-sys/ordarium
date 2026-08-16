import type { GuaranteeLevel } from "./effects.js";
import type { JsonValue } from "./json.js";

export type OperationState =
  | "proposed"
  | "authorized"
  | "denied"
  | "claimed"
  | "dispatched"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "uncertain"
  | "reconciled";

export interface InvocationIdentity {
  source: string;
  scope: string;
  callId: string;
  rootCallId?: string | undefined;
  actor?: string | undefined;
  lineage?: string[] | undefined;
}

/**
 * Transient reference to the Provider principal a credential resolves to.
 * It lives in memory only; records persist at most its canonical digest,
 * which acts as a continuity conflict field for the same operation
 * (docs/13 §2): recovery must resolve to the same principal or fail closed.
 */
export interface ProviderPrincipalRef {
  readonly namespace: string;
  readonly subject: string;
}

export type AuthorizationEvidenceKind =
  | "host-admission"
  | "policy-decision"
  | "human-approval";

export interface AuthorizationDecision {
  decision: "allow" | "deny";
  kind: AuthorizationEvidenceKind;
  source: string;
  reason?: string | undefined;
}

export interface AuthorizationRecord extends AuthorizationDecision {
  at: string;
}

export interface OperationClaim {
  owner: string;
  fencingToken: number;
  acquiredAt: string;
  resumeFrom?: "authorized" | "dispatched" | "uncertain" | undefined;
}

export interface SafeError {
  code: string;
  message: string;
}

export interface UncertaintyRecord {
  reason: string;
  at: string;
}

export interface ReconciliationRecord {
  outcome: "failed" | "succeeded";
  at: string;
}

/**
 * Semantic operation record (G2 design spec §1). `updatedAt` only moves with
 * semantic changes; heartbeat liveness lives exclusively in the LiveLease.
 */
export interface OperationRecord {
  schemaVersion: 2;
  operationId: string;
  actionName: string;
  actionVersion: string;
  contractFingerprint?: string | undefined;
  inputDigest: string;
  logicalKeyDigest: string;
  providerPrincipalDigest?: string | undefined;
  identity: InvocationIdentity;
  effectKind: GuaranteeLevel;
  idempotencyMode: "none" | "operation-key";
  idempotencyExpiresAt?: string | undefined;
  state: OperationState;
  semanticRevision: number;
  attempts: number;
  lastFencingToken: number;
  authorization?: AuthorizationRecord | undefined;
  claim?: OperationClaim | undefined;
  result?: JsonValue | undefined;
  receipt?: JsonValue | undefined;
  error?: SafeError | undefined;
  uncertainty?: UncertaintyRecord | undefined;
  reconciliation?: ReconciliationRecord | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface OperationEvent {
  operationId: string;
  semanticRevision: number;
  state: OperationState;
  at: string;
  record: OperationRecord;
}

/** Current operational liveness for one operation; never part of business history. */
export interface LiveLease {
  operationId: string;
  owner: string;
  fencingToken: number;
  expiresAt: string;
  leaseRevision: number;
}

export interface ClaimRequest {
  owner: string;
  fencingToken: number;
  acquiredAt: string;
  resumeFrom: "authorized" | "dispatched" | "uncertain";
}

export interface OperationListFilter {
  actionName?: string | undefined;
  state?: OperationState | undefined;
  limit?: number | undefined;
}

export interface OperationPage {
  records: OperationRecord[];
  nextCursor?: string | undefined;
}

export interface OperationEventPage {
  events: OperationEvent[];
  nextCursor?: string | undefined;
}

export type LedgerCoordination =
  | "single-isolate"
  | "single-process-exclusive"
  | "local-multi-process";

/**
 * Static, honest capability declaration every OperationLedger implementation
 * must provide (docs/13 §6.1). The runtime gate reads this contract - it
 * never infers durability from an implementation class name, and a managed
 * write on an insufficient ledger fails closed before any operation exists.
 */
export interface LedgerCapabilities {
  readonly durability: "volatile" | "crash-durable";
  readonly coordination: LedgerCoordination;
  readonly semanticCas: true;
  readonly liveLease: boolean;
  readonly semanticHistory: boolean;
}

export interface OperationLedger {
  readonly capabilities: LedgerCapabilities;
  get(operationId: string): Promise<OperationRecord | undefined>;
  create(record: OperationRecord): Promise<{ created: boolean; record: OperationRecord }>;
  compareAndSet(
    operationId: string,
    expectedRevision: number,
    next: OperationRecord,
  ): Promise<boolean>;
  /** Semantic claim plus lease creation in one transaction; false when busy. */
  claim(
    operationId: string,
    expectedRevision: number,
    request: ClaimRequest,
    lease: { owner: string; fencingToken: number; expiresAt: string },
  ): Promise<boolean>;
  lease(operationId: string): Promise<LiveLease | undefined>;
  /** Lightweight liveness renewal - must not touch semantic state or history. */
  renewLease(
    operationId: string,
    owner: string,
    fencingToken: number,
    expiresAt: string,
  ): Promise<boolean>;
  history(operationId: string, cursor?: string, limit?: number): Promise<OperationEventPage>;
  list(filter?: OperationListFilter, cursor?: string): Promise<OperationPage>;
  close?(): Promise<void> | void;
}
