/**
 * Schema truth and forward migrations for the SQLite ledger (internal
 * cohesion, 2026-09-07): the DDL, the private-v1 boundary transform and the
 * v1→v3 / v2→v3 transactional migrations. Migration bodies throw raw
 * errors on any failure; the ledger class owns the transaction rollback and
 * the stable error-family mapping at the call site, so this module stays
 * free of the failure-mapping dependency and never imports back into the
 * ledger module.
 */

import { DatabaseSync } from "node:sqlite";

import {
  LedgerCorruptError,
  decodeOperationRecord,
  type LiveLease,
  type OperationRecord,
} from "@ordarium/core";

export const LEDGER_SCHEMA_VERSION = 4;

export function createSchema(db: DatabaseSync): void {
  db.exec(`
      CREATE TABLE IF NOT EXISTS ordarium_operations (
        operation_id TEXT PRIMARY KEY,
        semantic_revision INTEGER NOT NULL,
        state TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        record_json TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS ordarium_operation_events (
        operation_id TEXT NOT NULL,
        semantic_revision INTEGER NOT NULL,
        state TEXT NOT NULL,
        at TEXT NOT NULL,
        record_json TEXT NOT NULL,
        PRIMARY KEY (operation_id, semantic_revision),
        FOREIGN KEY (operation_id) REFERENCES ordarium_operations(operation_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS ordarium_operation_leases (
        operation_id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        fencing_token INTEGER NOT NULL,
        expires_at TEXT NOT NULL,
        lease_revision INTEGER NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS ordarium_operations_state_idx
        ON ordarium_operations(state, updated_at DESC);
  `);
  createStateTables(db);
}

/**
 * One-shot transactional forward migration from the private v1 layout
 * (G2 design spec §3, G2-A01/A02): read every v1 record, transform it at
 * this boundary, validate through the current core codec, rebuild all
 * three tables and bump user_version. Throws raw on any failure — the
 * caller rolls the database back to its intact v1 state and maps the
 * error family.
 */
export function migrateFromV1(db: DatabaseSync): void {
  db.exec("BEGIN IMMEDIATE");
  const operations = db
    .prepare("SELECT record_json FROM ordarium_operations")
    .all()
    .map((row) => JSON.parse(requireString(row.record_json)));
  const events = db
    .prepare("SELECT at, record_json FROM ordarium_operation_events ORDER BY operation_id, revision")
    .all()
    .map((row) => ({ at: requireString(row.at), raw: JSON.parse(requireString(row.record_json)) }));

  db.exec("DROP TABLE ordarium_operation_events");
  db.exec("DROP TABLE ordarium_operations");
  createSchema(db);

  const insertOperation = db.prepare(`
    INSERT INTO ordarium_operations(operation_id, semantic_revision, state, updated_at, record_json)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertLease = db.prepare(`
    INSERT INTO ordarium_operation_leases(operation_id, owner, fencing_token, expires_at, lease_revision)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertEvent = db.prepare(`
    INSERT INTO ordarium_operation_events(operation_id, semantic_revision, state, at, record_json)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const raw of operations) {
    const { record, lease } = transformV1Record(raw);
    insertOperation.run(
      record.operationId,
      record.semanticRevision,
      record.state,
      record.updatedAt,
      JSON.stringify(record),
    );
    if (lease !== undefined) {
      insertLease.run(
        lease.operationId,
        lease.owner,
        lease.fencingToken,
        lease.expiresAt,
        lease.leaseRevision,
      );
    }
  }
  for (const event of events) {
    const { record } = transformV1Record(event.raw);
    insertEvent.run(
      record.operationId,
      record.semanticRevision,
      record.state,
      event.at,
      JSON.stringify(record),
    );
  }

  db.exec(`PRAGMA user_version = ${LEDGER_SCHEMA_VERSION}`);
  db.exec("COMMIT");
}

/**
 * Additive v2 -> current migration (G11 design spec §4, extended by
 * ORD-BOOT-0): the state kind and the change-feed ordering table only add
 * tables and indexes, so no existing row is touched. Throws raw on any
 * failure — the caller rolls the database back to its intact v2 state.
 */
export function migrateFromV2(db: DatabaseSync): void {
  db.exec("BEGIN IMMEDIATE");
  createStateTables(db);
  db.exec(`PRAGMA user_version = ${LEDGER_SCHEMA_VERSION}`);
  db.exec("COMMIT");
}

/**
 * Additive v3 -> v4 migration (ORD-BOOT-0 spec §7). v3 recorded no global
 * commit order, so the feed cannot recover it: existing revisions receive a
 * deterministic synthetic position in (namespace, key, revision) order,
 * explicitly labelled as migration order rather than original commit order.
 * From v4 on, every new commit carries the real durable database order.
 * Throws raw on any failure — the caller rolls the database back to its
 * intact v3 state.
 */
export function migrateFromV3(db: DatabaseSync): void {
  db.exec("BEGIN IMMEDIATE");
  createStateTables(db);
  // ROW_NUMBER() assigns 1..n deterministically; AUTOINCREMENT then continues
  // from the highest explicit value for all post-migration commits.
  db.exec(`
    INSERT INTO ordarium_state_changes(change_seq, namespace, key, revision)
    SELECT ROW_NUMBER() OVER (ORDER BY namespace ASC, key ASC, revision ASC),
           namespace, key, revision
    FROM ordarium_state_revisions
  `);
  const revisions = requireCount(db, "ordarium_state_revisions");
  const changes = requireCount(db, "ordarium_state_changes");
  if (revisions !== changes) {
    throw new Error(
      `state change backfill covered ${changes} of ${revisions} state revisions`,
    );
  }
  db.exec(`PRAGMA user_version = ${LEDGER_SCHEMA_VERSION}`);
  db.exec("COMMIT");
}

function createStateTables(db: DatabaseSync): void {
  db.exec(`
      CREATE TABLE IF NOT EXISTS ordarium_state_revisions (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        revision INTEGER NOT NULL,
        value_digest TEXT NOT NULL,
        written_at TEXT NOT NULL,
        record_json TEXT NOT NULL,
        PRIMARY KEY (namespace, key, revision)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS ordarium_state_refs (
        ref_kind TEXT NOT NULL,
        ref_id TEXT NOT NULL,
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        revision INTEGER NOT NULL,
        PRIMARY KEY (ref_kind, ref_id, namespace, key, revision),
        FOREIGN KEY (namespace, key, revision)
          REFERENCES ordarium_state_revisions(namespace, key, revision)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS ordarium_state_refs_ref_idx
        ON ordarium_state_refs(ref_kind, ref_id);

      CREATE INDEX IF NOT EXISTS ordarium_state_revisions_ns_idx
        ON ordarium_state_revisions(namespace, written_at DESC);

      CREATE TABLE IF NOT EXISTS ordarium_state_changes (
        change_seq INTEGER PRIMARY KEY AUTOINCREMENT,
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        revision INTEGER NOT NULL,
        UNIQUE (namespace, key, revision),
        FOREIGN KEY (namespace, key, revision)
          REFERENCES ordarium_state_revisions(namespace, key, revision)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS ordarium_state_changes_ns_idx
        ON ordarium_state_changes(namespace, change_seq);
  `);
}

function requireCount(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
  const count = row?.count;
  if (typeof count !== "number") {
    throw new LedgerCorruptError();
  }
  return count;
}

function requireString(value: unknown): string {
  if (typeof value !== "string") {
    throw new LedgerCorruptError();
  }
  return value;
}

function transformV1Record(raw: unknown): { record: OperationRecord; lease: LiveLease | undefined } {
  const v1 = raw as Record<string, unknown>;
  assertV1Record(v1);
  const claim = v1.claim as
    | { owner: string; expiresAt: string; fencingToken: number }
    | undefined;
  const record = {
    schemaVersion: 2,
    operationId: v1.operationId,
    actionName: v1.actionName,
    actionVersion: v1.actionVersion,
    ...(v1.contractFingerprint === undefined ? {} : { contractFingerprint: v1.contractFingerprint }),
    inputDigest: v1.inputDigest,
    logicalKeyDigest: v1.logicalKeyDigest,
    ...(v1.providerPrincipalDigest === undefined
      ? {}
      : { providerPrincipalDigest: v1.providerPrincipalDigest }),
    identity: v1.identity,
    effectKind: v1.guarantee,
    idempotencyMode: v1.guarantee === "idempotent" ? "operation-key" : "none",
    state: v1.state,
    semanticRevision: v1.revision,
    attempts: v1.attempts,
    lastFencingToken: v1.lastFencingToken,
    ...(v1.authorization === undefined ? {} : { authorization: v1.authorization }),
    ...(claim === undefined
      ? {}
      : {
          claim: {
            owner: claim.owner,
            fencingToken: claim.fencingToken,
            acquiredAt: v1.updatedAt,
            ...(v1.state === "claimed" && v1.resumeFrom !== undefined
              ? { resumeFrom: v1.resumeFrom }
              : {}),
          },
        }),
    ...(v1.result === undefined ? {} : { result: v1.result }),
    ...(v1.receipt === undefined ? {} : { receipt: v1.receipt }),
    ...(v1.error === undefined ? {} : { error: v1.error }),
    ...(v1.uncertainty === undefined ? {} : { uncertainty: v1.uncertainty }),
    ...(v1.reconciliation === undefined ? {} : { reconciliation: v1.reconciliation }),
    createdAt: v1.createdAt,
    updatedAt: v1.updatedAt,
  };
  decodeOperationRecord(record);
  const lease = claim === undefined ? undefined : {
    operationId: v1.operationId as string,
    owner: claim.owner,
    fencingToken: claim.fencingToken,
    expiresAt: claim.expiresAt,
    leaseRevision: 1,
  };
  return { record: record as OperationRecord, lease };
}

/**
 * Boundary-only shallow validation of the private v1 record shape. The
 * current core codec never accepts these; migration converts them and then
 * validates the v2 result through the single core codec.
 */
function assertV1Record(v1: Record<string, unknown>): void {
  if (v1.schemaVersion !== 1) {
    throw new TypeError("legacy record is not schema v1");
  }
  const V1_STATES = new Set([
    "proposed", "authorized", "denied", "claimed",
    "dispatched", "succeeded", "failed", "cancelled", "uncertain", "reconciled",
  ]);
  const V1_GUARANTEES = new Set(["read-only", "guarded", "idempotent", "reconcilable", "unmanaged"]);
  for (const key of ["operationId", "actionName", "actionVersion", "inputDigest", "logicalKeyDigest", "createdAt", "updatedAt"]) {
    if (typeof v1[key] !== "string" || (v1[key] as string).length === 0) {
      throw new TypeError(`legacy record field is invalid: ${key}`);
    }
  }
  if (!V1_STATES.has(String(v1.state)) || !V1_GUARANTEES.has(String(v1.guarantee))) {
    throw new TypeError("legacy record has an unknown state or guarantee");
  }
  for (const key of ["revision", "attempts", "lastFencingToken"]) {
    if (!Number.isSafeInteger(v1[key]) || (v1[key] as number) < 0) {
      throw new TypeError(`legacy record integer is invalid: ${key}`);
    }
  }
  const identity = v1.identity as Record<string, unknown> | null;
  if (identity === null || typeof identity !== "object") {
    throw new TypeError("legacy record identity is invalid");
  }
  for (const key of ["source", "scope", "callId"]) {
    if (typeof identity[key] !== "string" || (identity[key] as string).length === 0) {
      throw new TypeError(`legacy record identity field is invalid: ${key}`);
    }
  }
}
