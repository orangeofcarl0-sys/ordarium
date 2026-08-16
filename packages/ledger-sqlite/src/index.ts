import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  LedgerBusyError,
  LedgerClosedError,
  LedgerCorruptError,
  LedgerFullError,
  LedgerMigrationFailedError,
  LedgerNewerSchemaError,
  LedgerOpenFailedError,
  decodeOperationRecord,
  type ClaimRequest,
  type LiveLease,
  type OperationEvent,
  type OperationEventPage,
  type OperationLedger,
  type OperationListFilter,
  type OperationPage,
  type OperationRecord,
} from "@ordarium/core";

const APPLICATION_ID = 0x4f524441; // ASCII "ORDA"
const LEDGER_SCHEMA_VERSION = 2;
const DEFAULT_PAGE_LIMIT = 100;

export interface SqliteLedgerOptions {
  timeoutMs?: number | undefined;
  clock?: (() => Date) | undefined;
}

/**
 * Crash-durable SQLite reference ledger implementing the full v2 port
 * contract (G2 design spec §2/§3): semantic CAS with fence verification,
 * atomic claim+lease, lightweight lease renewal that never touches semantic
 * state, opaque cursor pagination, a transactional v1->v2 forward migration
 * and a stable infrastructure error family.
 */
export class SqliteLedger implements OperationLedger {
  readonly capabilities = {
    durability: "crash-durable",
    coordination: "local-multi-process",
    semanticCas: true,
    liveLease: true,
    semanticHistory: true,
  } as const;

  readonly path: string;
  readonly #database: DatabaseSync;
  readonly #clock: () => Date;
  #closed = false;

  constructor(path: string, options: SqliteLedgerOptions = {}) {
    this.#clock = options.clock ?? (() => new Date());
    this.path = path === ":memory:" ? path : resolve(path);
    try {
      if (this.path !== ":memory:") {
        mkdirSync(dirname(this.path), { recursive: true });
      }
      this.#database = new DatabaseSync(this.path, {
        timeout: options.timeoutMs ?? 5_000,
        enableForeignKeyConstraints: true,
      });
      this.#database.exec("PRAGMA journal_mode = WAL");
      this.#database.exec("PRAGMA synchronous = FULL");
    } catch (error) {
      throw mapSqliteFailure(error);
    }

    const applicationId = this.#pragmaNumber("application_id");
    if (applicationId !== 0 && applicationId !== APPLICATION_ID) {
      this.#closeSilently();
      throw new LedgerOpenFailedError("the file belongs to another application");
    }
    const schemaVersion = this.#pragmaNumber("user_version");
    if (schemaVersion > LEDGER_SCHEMA_VERSION) {
      this.#closeSilently();
      throw new LedgerNewerSchemaError(schemaVersion);
    }
    try {
      if (applicationId === 0) this.#database.exec(`PRAGMA application_id = ${APPLICATION_ID}`);
      if (schemaVersion === 0) {
        this.#createSchema();
        this.#database.exec(`PRAGMA user_version = ${LEDGER_SCHEMA_VERSION}`);
      } else if (schemaVersion === 1) {
        this.#migrateFromV1();
      }
    } catch (error) {
      this.#closeSilently();
      if (error instanceof LedgerNewerSchemaError || error instanceof LedgerMigrationFailedError) {
        throw error;
      }
      throw new LedgerMigrationFailedError(describe(error));
    }
  }

  async get(operationId: string): Promise<OperationRecord | undefined> {
    this.#assertOpen();
    const row = this.#prepare(
      "SELECT record_json FROM ordarium_operations WHERE operation_id = ?",
    ).get(operationId);
    return row === undefined ? undefined : this.#parseRecord(row.record_json);
  }

  async create(record: OperationRecord): Promise<{ created: boolean; record: OperationRecord }> {
    this.#assertOpen();
    decodeOperationRecord(record);
    try {
      this.#begin();
      const current = this.#prepare(
        "SELECT record_json FROM ordarium_operations WHERE operation_id = ?",
      ).get(record.operationId);
      if (current !== undefined) {
        this.#commit();
        return { created: false, record: this.#parseRecord(current.record_json) };
      }

      const serialized = JSON.stringify(record);
      this.#prepare(`
        INSERT INTO ordarium_operations(operation_id, semantic_revision, state, updated_at, record_json)
        VALUES (?, ?, ?, ?, ?)
      `).run(record.operationId, record.semanticRevision, record.state, record.updatedAt, serialized);
      this.#insertEvent(record, serialized);
      this.#commit();
      return { created: true, record: structuredClone(record) };
    } catch (error) {
      this.#rollback();
      throw mapSqliteFailure(error);
    }
  }

  async compareAndSet(
    operationId: string,
    expectedRevision: number,
    next: OperationRecord,
  ): Promise<boolean> {
    this.#assertOpen();
    if (next.operationId !== operationId || next.semanticRevision !== expectedRevision + 1) {
      return false;
    }
    decodeOperationRecord(next);

    try {

      this.#begin();
      const lease = this.#selectLease(operationId);
      if (lease !== undefined && lease.fencing_token !== next.lastFencingToken) {
        this.#commit();
        return false;
      }
      const serialized = JSON.stringify(next);
      const result = this.#prepare(`
        UPDATE ordarium_operations
        SET semantic_revision = ?, state = ?, updated_at = ?, record_json = ?
        WHERE operation_id = ? AND semantic_revision = ?
      `).run(
        next.semanticRevision,
        next.state,
        next.updatedAt,
        serialized,
        operationId,
        expectedRevision,
      );
      if (result.changes === 0) {
        this.#commit();
        return false;
      }
      this.#insertEvent(next, serialized);
      if (next.claim === undefined) {
        this.#prepare("DELETE FROM ordarium_operation_leases WHERE operation_id = ?")
          .run(operationId);
      }
      this.#commit();
      return true;
    } catch (error) {
      this.#rollback();
      throw mapSqliteFailure(error);
    }
  }

  async claim(
    operationId: string,
    expectedRevision: number,
    request: ClaimRequest,
    lease: { owner: string; fencingToken: number; expiresAt: string },
  ): Promise<boolean> {
    this.#assertOpen();
    try {
      this.#begin();
      const row = this.#prepare(
        "SELECT record_json FROM ordarium_operations WHERE operation_id = ?",
      ).get(operationId);
      if (row === undefined) {
        this.#commit();
        return false;
      }
      const current = this.#parseRecord(row.record_json);
      if (current.semanticRevision !== expectedRevision) {
        this.#commit();
        return false;
      }
      const active = this.#selectLease(operationId);
      const now = this.#clock().toISOString();
      if (
        active !== undefined &&
        active.owner !== request.owner &&
        active.expires_at > now
      ) {
        this.#commit();
        return false;
      }

      const next: OperationRecord = {
        ...current,
        state: "claimed",
        semanticRevision: expectedRevision + 1,
        lastFencingToken: request.fencingToken,
        claim: {
          owner: request.owner,
          fencingToken: request.fencingToken,
          acquiredAt: request.acquiredAt,
          resumeFrom: request.resumeFrom,
        },
        updatedAt: request.acquiredAt,
      };
      decodeOperationRecord(next);
      const serialized = JSON.stringify(next);
      this.#prepare(`
        UPDATE ordarium_operations
        SET semantic_revision = ?, state = ?, updated_at = ?, record_json = ?
        WHERE operation_id = ? AND semantic_revision = ?
      `).run(
        next.semanticRevision,
        next.state,
        next.updatedAt,
        serialized,
        operationId,
        expectedRevision,
      );
      this.#insertEvent(next, serialized);
      this.#prepare(`
        INSERT INTO ordarium_operation_leases(operation_id, owner, fencing_token, expires_at, lease_revision)
        VALUES (?, ?, ?, ?, 1)
        ON CONFLICT(operation_id) DO UPDATE SET
          owner = excluded.owner,
          fencing_token = excluded.fencing_token,
          expires_at = excluded.expires_at,
          lease_revision = ordarium_operation_leases.lease_revision + 1
      `).run(operationId, lease.owner, lease.fencingToken, lease.expiresAt);
      this.#commit();
      return true;
    } catch (error) {
      this.#rollback();
      throw mapSqliteFailure(error);
    }
  }

  async lease(operationId: string): Promise<LiveLease | undefined> {
    this.#assertOpen();
    const row = this.#selectLease(operationId);
    return row === undefined ? undefined : {
      operationId,
      owner: row.owner,
      fencingToken: row.fencing_token,
      expiresAt: row.expires_at,
      leaseRevision: row.lease_revision,
    };
  }

  async renewLease(
    operationId: string,
    owner: string,
    fencingToken: number,
    expiresAt: string,
  ): Promise<boolean> {
    this.#assertOpen();
    try {
      const result = this.#prepare(`
        UPDATE ordarium_operation_leases
        SET expires_at = ?, lease_revision = lease_revision + 1
        WHERE operation_id = ? AND owner = ? AND fencing_token = ?
      `).run(expiresAt, operationId, owner, fencingToken);
      return result.changes > 0;
    } catch (error) {
      throw mapSqliteFailure(error);
    }
  }

  async history(
    operationId: string,
    cursor?: string,
    limit?: number,
  ): Promise<OperationEventPage> {
    this.#assertOpen();
    const after = cursor === undefined ? -1 : decodeHistoryCursor(cursor);
    const bound = Math.max(0, limit ?? DEFAULT_PAGE_LIMIT);
    const rows = this.#prepare(`
      SELECT operation_id, semantic_revision, state, at, record_json
      FROM ordarium_operation_events
      WHERE operation_id = ? AND semantic_revision > ?
      ORDER BY semantic_revision ASC
      LIMIT ?
    `).all(operationId, after, bound + 1);
    const events = rows.map((row) => {
      const record = this.#parseRecord(row.record_json);
      const semanticRevision = this.#number(row.semantic_revision);
      const state = this.#string(row.state);
      if (
        record.operationId !== this.#string(row.operation_id) ||
        record.semanticRevision !== semanticRevision ||
        record.state !== state
      ) {
        throw new LedgerCorruptError();
      }
      return {
        operationId: record.operationId,
        semanticRevision,
        state,
        at: this.#string(row.at),
        record,
      } satisfies OperationEvent;
    });
    const page = events.slice(0, bound);
    const last = page[page.length - 1];
    const nextCursor = events.length > bound && last !== undefined
      ? encodeCursor({ r: String(last.semanticRevision) })
      : undefined;
    return { events: page, ...(nextCursor === undefined ? {} : { nextCursor }) };
  }

  async list(filter: OperationListFilter = {}, cursor?: string): Promise<OperationPage> {
    this.#assertOpen();
    const clauses: string[] = [];
    const parameters: (number | string)[] = [];
    if (filter.actionName !== undefined) {
      clauses.push("json_extract(record_json, '$.actionName') = ?");
      parameters.push(filter.actionName);
    }
    if (filter.state !== undefined) {
      clauses.push("state = ?");
      parameters.push(filter.state);
    }
    const after = cursor === undefined ? undefined : decodeListCursor(cursor);
    if (after !== undefined) {
      clauses.push("(updated_at < ? OR (updated_at = ? AND operation_id < ?))");
      parameters.push(after.u, after.u, after.o);
    }
    const where = clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`;
    const bound = Math.max(0, filter.limit ?? DEFAULT_PAGE_LIMIT);
    const rows = this.#prepare(`
      SELECT record_json
      FROM ordarium_operations
      ${where}
      ORDER BY updated_at DESC, operation_id DESC
      LIMIT ?
    `).all(...parameters, bound + 1);
    const records = rows.slice(0, bound).map((row) => this.#parseRecord(row.record_json));
    const last = records[records.length - 1];
    const nextCursor = rows.length > bound && last !== undefined
      ? encodeCursor({ u: last.updatedAt, o: last.operationId })
      : undefined;
    return { records, ...(nextCursor === undefined ? {} : { nextCursor }) };
  }

  close(): void {
    if (!this.#closed) {
      this.#database.close();
      this.#closed = true;
    }
  }

  #createSchema(): void {
    this.#database.exec(`
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
  }

  /**
   * One-shot transactional forward migration from the private v1 layout
   * (G2 design spec §3, G2-A01/A02): read every v1 record, transform it at
   * this boundary, validate through the current core codec, rebuild all
   * three tables and bump user_version. Any failure rolls the database back
   * to its intact v1 state.
   */
  #migrateFromV1(): void {
    try {
      this.#begin();
      const operations = this.#database
        .prepare("SELECT record_json FROM ordarium_operations")
        .all()
        .map((row) => JSON.parse(this.#string(row.record_json)));
      const events = this.#database
        .prepare("SELECT at, record_json FROM ordarium_operation_events ORDER BY operation_id, revision")
        .all()
        .map((row) => ({ at: this.#string(row.at), raw: JSON.parse(this.#string(row.record_json)) }));

      this.#database.exec("DROP TABLE ordarium_operation_events");
      this.#database.exec("DROP TABLE ordarium_operations");
      this.#createSchema();

      const insertOperation = this.#database.prepare(`
        INSERT INTO ordarium_operations(operation_id, semantic_revision, state, updated_at, record_json)
        VALUES (?, ?, ?, ?, ?)
      `);
      const insertLease = this.#database.prepare(`
        INSERT INTO ordarium_operation_leases(operation_id, owner, fencing_token, expires_at, lease_revision)
        VALUES (?, ?, ?, ?, ?)
      `);
      const insertEvent = this.#database.prepare(`
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

      this.#database.exec(`PRAGMA user_version = ${LEDGER_SCHEMA_VERSION}`);
      this.#commit();
    } catch (error) {
      this.#rollback();
      if (error instanceof LedgerMigrationFailedError) throw error;
      throw new LedgerMigrationFailedError(describe(error));
    }
  }

  #selectLease(operationId: string): {
    owner: string;
    fencing_token: number;
    expires_at: string;
    lease_revision: number;
  } | undefined {
    return this.#database
      .prepare(
        "SELECT owner, fencing_token, expires_at, lease_revision FROM ordarium_operation_leases WHERE operation_id = ?",
      )
      .get(operationId) as
      | { owner: string; fencing_token: number; expires_at: string; lease_revision: number }
      | undefined;
  }

  #insertEvent(record: OperationRecord, serialized: string): void {
    this.#prepare(`
      INSERT INTO ordarium_operation_events(operation_id, semantic_revision, state, at, record_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(record.operationId, record.semanticRevision, record.state, record.updatedAt, serialized);
  }

  #parseRecord(value: unknown): OperationRecord {
    try {
      return decodeOperationRecord(JSON.parse(this.#string(value)));
    } catch (error) {
      if (error instanceof LedgerCorruptError) throw error;
      throw new LedgerCorruptError();
    }
  }

  #prepare(sql: string) {
    return this.#database.prepare(sql);
  }

  #string(value: unknown): string {
    if (typeof value !== "string") {
      throw new LedgerCorruptError();
    }
    return value;
  }

  #number(value: unknown): number {
    if (typeof value !== "number") {
      throw new LedgerCorruptError();
    }
    return value;
  }

  #pragmaNumber(name: "application_id" | "user_version"): number {
    const row = this.#prepare(`PRAGMA ${name}`).get();
    if (row === undefined) throw new LedgerOpenFailedError(`unable to read PRAGMA ${name}`);
    return this.#number(row[name]);
  }

  #begin(): void {
    this.#database.exec("BEGIN IMMEDIATE");
  }

  #commit(): void {
    this.#database.exec("COMMIT");
  }

  #rollback(): void {
    try {
      this.#database.exec("ROLLBACK");
    } catch {
      // Preserve the original transaction failure.
    }
  }

  #closeSilently(): void {
    try {
      this.#database.close();
    } catch {
      // Already closing after a hard failure.
    }
    this.#closed = true;
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new LedgerClosedError();
    }
  }
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

function mapSqliteFailure(error: unknown): Error {
  const code = (error as { code?: string }).code ?? "";
  const message = error instanceof Error ? error.message : String(error);
  if (
    code.includes("SQLITE_BUSY") ||
    code.includes("SQLITE_LOCKED") ||
    /database is locked|database table is locked/iu.test(message)
  ) {
    return new LedgerBusyError();
  }
  if (code.includes("SQLITE_CORRUPT") || code.includes("SQLITE_NOTADB") || /malformed/iu.test(message)) {
    return new LedgerCorruptError();
  }
  if (code.includes("SQLITE_FULL") || /database or disk is full/iu.test(message)) {
    return new LedgerFullError();
  }
  return error instanceof Error ? error : new Error(message);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function encodeCursor(payload: Record<string, string>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursorPayload(cursor: string): Record<string, string> {
  const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new LedgerCorruptError();
  }
  return parsed as Record<string, string>;
}

function decodeListCursor(cursor: string): { u: string; o: string } {
  const parsed = decodeCursorPayload(cursor);
  if (typeof parsed.u !== "string" || typeof parsed.o !== "string") {
    throw new LedgerCorruptError();
  }
  return { u: parsed.u, o: parsed.o };
}

function decodeHistoryCursor(cursor: string): number {
  const revision = Number(decodeCursorPayload(cursor).r);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new LedgerCorruptError();
  }
  return revision;
}
