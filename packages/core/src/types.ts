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
  /** Filter by the invocation identity scope; the derived-view primitive behind "budget as a ledger query". */
  scope?: string | undefined;
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

/**
 * Typed pointer from a management state revision to another timeline object
 * (G11 design spec §1). The kernel stores and existence-checks references;
 * it never interprets them - invalidation propagation stays host-side.
 */
export interface StateRef {
  kind: "operation" | "state";
  /** An operationId, or a state revision encoded as "namespace/key@revision". */
  id: string;
}

/**
 * One revision of a management state subject (G11 design spec §1). Subjects
 * are host-declared mutable slots addressed by (namespace, key); every
 * revision records the writer's invocation identity so the shared timeline
 * chains across record kinds. Append-only: revocation is expressed by
 * writing a new revision.
 */
export interface StateRecord {
  schemaVersion: 1;
  namespace: string;
  key: string;
  /** Monotonic per subject; the first write is revision 1. */
  revision: number;
  value: JsonValue;
  /** Canonical content digest of value; a decode-time integrity invariant. */
  valueDigest: string;
  refs: StateRef[];
  identity: InvocationIdentity;
  authorization?: AuthorizationRecord | undefined;
  writtenAt: string;
}

export interface StateRevisionPage {
  revisions: StateRecord[];
  nextCursor?: string | undefined;
}

export interface StateRecordPage {
  records: StateRecord[];
  nextCursor?: string | undefined;
}

export interface StateListFilter {
  namespace?: string | undefined;
  limit?: number | undefined;
}

/** Optional narrowing for the revisioned state change feed (ORD-BOOT-0). */
export interface StateChangeFilter {
  /** Restrict observation to one namespace; absent observes every namespace. */
  namespace?: string | undefined;
  /** Bounded page size; absent uses the ledger default. */
  limit?: number | undefined;
}

/**
 * One page of committed state revisions in durable ledger commit-observation
 * order, ascending (ORD-BOOT-0). Unlike the `nextCursor?` pagination of the
 * other read surfaces, `cursor` is always present: a consumer reaches the end
 * of the feed and still holds a durable resume position for revisions
 * committed later.
 */
export interface StateChangePage {
  changes: StateRecord[];
  /** Opaque, filter-independent durable position of the last delivered change. */
  cursor: string;
  /** True when at least one further matching change already exists past this page. */
  hasMore: boolean;
}

/**
 * Additive observation capability over the state kind: read committed
 * revisions after a durable position without polling each subject
 * individually. It is deliberately not part of `OperationLedger`, so
 * existing ledger implementations stay source-compatible; a ledger declares
 * it through `LedgerCapabilities.stateChangeFeed` and `supportsStateChangeFeed`
 * is the fail-closed entry.
 */
export interface StateChangeFeed {
  changes(filter?: StateChangeFilter, cursor?: string): Promise<StateChangePage>;
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
  /** Revisioned management state (the G11 state kind) on the same timeline machinery. */
  readonly stateRevisions: boolean;
  /**
   * Incremental observation of committed state revisions after a durable
   * position (ORD-BOOT-0). Optional so existing custom ledgers keep compiling;
   * absent means the capability is not offered and `StateStore.changes` fails
   * closed with LEDGER_CAPABILITY_REQUIRED.
   */
  readonly stateChangeFeed?: boolean | undefined;
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
  /** Current revision of a management state subject; undefined when absent. */
  getState(namespace: string, key: string): Promise<StateRecord | undefined>;
  /**
   * Optimistic revision CAS for a state subject (G11 §1): expectedRevision 0
   * creates the subject; false means the revision moved or the subject is
   * absent. No lease - the CAS is the whole arbitration.
   */
  compareAndSetState(
    namespace: string,
    key: string,
    expectedRevision: number,
    next: StateRecord,
  ): Promise<boolean>;
  stateHistory(
    namespace: string,
    key: string,
    cursor?: string,
    limit?: number,
  ): Promise<StateRevisionPage>;
  listStatesReferencing(ref: StateRef, cursor?: string, limit?: number): Promise<StateRecordPage>;
  listStates(filter?: StateListFilter, cursor?: string): Promise<StateRecordPage>;
  close?(): Promise<void> | void;
}
