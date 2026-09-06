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
  OrdariumError,
  decodeOperationRecord,
  decodeStateRecord,
  type ClaimRequest,
  type LiveLease,
  type OperationEvent,
  type OperationEventPage,
  type OperationLedger,
  type OperationListFilter,
  type OperationPage,
  type OperationRecord,
  type StateListFilter,
  type StateRecord,
  type StateRecordPage,
  type StateRef,
  type StateRevisionPage,
} from "@ordarium/core";

import { createSchema, migrateFromV1, migrateFromV2, LEDGER_SCHEMA_VERSION } from "./migrations.js";

const APPLICATION_ID = 0x4f524441; // ASCII "ORDA"
const DEFAULT_PAGE_LIMIT = 100;

export interface SqliteLedgerOpenRetry {
  /** Total attempts including the first; 1 restores fail-fast. Default 5. */
  attempts?: number | undefined;
  /** Fixed delay between attempts in milliseconds. Default 100. */
  delayMs?: number | undefined;
}

export interface SqliteLedgerOptions {
  timeoutMs?: number | undefined;
  clock?: (() => Date) | undefined;
  /**
   * Open-boundary retry (G16): only LEDGER_BUSY failures (including a busy
   * migration segment) are retried with a fixed delay; corruption, newer
   * schema and migration-failure errors fail closed exactly once. Defaults
   * to { attempts: 5, delayMs: 100 }.
   */
  openRetry?: SqliteLedgerOpenRetry | undefined;
}

/**
 * Crash-durable SQLite reference ledger implementing the full v2 port
 * contract (G2 design spec §2/§3) plus the G11 state kind: semantic CAS with
 * fence verification, atomic claim+lease, lightweight lease renewal that
 * never touches semantic state, revision-CAS management state with a
 * reference reverse index, opaque cursor pagination, transactional forward
 * migrations (v1 -> v3 rebuild, v2 -> v3 additive) and a stable
 * infrastructure error family.
 */
export class SqliteLedger implements OperationLedger {
  readonly capabilities = {
    durability: "crash-durable",
    coordination: "local-multi-process",
    semanticCas: true,
    liveLease: true,
    semanticHistory: true,
    stateRevisions: true,
  } as const;

  readonly path: string;
  readonly #database: DatabaseSync;
  readonly #clock: () => Date;
  #closed = false;

  constructor(path: string, options: SqliteLedgerOptions = {}) {
    this.#clock = options.clock ?? (() => new Date());
    this.path = path === ":memory:" ? path : resolve(path);
    const retry = resolveOpenRetry(options.openRetry);
    for (let attempt = 1; ; attempt += 1) {
      let database: DatabaseSync | undefined;
      try {
        if (this.path !== ":memory:") {
          mkdirSync(dirname(this.path), { recursive: true });
        }
        database = new DatabaseSync(this.path, {
          timeout: options.timeoutMs ?? 5_000,
          enableForeignKeyConstraints: true,
        });
        this.#database = database;
        this.#database.exec("PRAGMA journal_mode = WAL");
        this.#database.exec("PRAGMA synchronous = FULL");
        const applicationId = this.#pragmaNumber("application_id");
        if (applicationId !== 0 && applicationId !== APPLICATION_ID) {
          throw new LedgerOpenFailedError("the file belongs to another application");
        }
        const schemaVersion = this.#pragmaNumber("user_version");
        if (schemaVersion > LEDGER_SCHEMA_VERSION) {
          throw new LedgerNewerSchemaError(schemaVersion);
        }
        if (applicationId === 0) this.#database.exec(`PRAGMA application_id = ${APPLICATION_ID}`);
        if (schemaVersion === 0) {
          createSchema(this.#database);
          this.#database.exec(`PRAGMA user_version = ${LEDGER_SCHEMA_VERSION}`);
        } else if (schemaVersion === 1) {
          this.#migrateFromV1();
        } else if (schemaVersion === 2) {
          this.#migrateFromV2();
        }
        return;
      } catch (error) {
        // Only the BUSY family crosses attempt boundaries; every other open
        // failure keeps its single-shot fail-closed semantics (G16 spec §1).
        const mapped = error instanceof OrdariumError ? error : mapSqliteFailure(error);
        try {
          database?.close();
        } catch {
          // The failed handle is discarded either way.
        }
        if (!(mapped instanceof LedgerBusyError) || attempt >= retry.attempts) {
          this.#closed = true;
          throw mapped;
        }
      }
      sleepSync(retry.delayMs);
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
    if (filter.scope !== undefined) {
      clauses.push("json_extract(record_json, '$.identity.scope') = ?");
      parameters.push(filter.scope);
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

  async getState(namespace: string, key: string): Promise<StateRecord | undefined> {
    this.#assertOpen();
    const row = this.#prepare(`
      SELECT namespace, key, revision, record_json
      FROM ordarium_state_revisions
      WHERE namespace = ? AND key = ?
      ORDER BY revision DESC
      LIMIT 1
    `).get(namespace, key);
    return row === undefined ? undefined : this.#parseStateRecord(row);
  }

  async compareAndSetState(
    namespace: string,
    key: string,
    expectedRevision: number,
    next: StateRecord,
  ): Promise<boolean> {
    this.#assertOpen();
    if (
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0 ||
      next.namespace !== namespace ||
      next.key !== key ||
      next.revision !== expectedRevision + 1
    ) {
      return false;
    }
    decodeStateRecord(next);

    try {
      this.#begin();
      if (expectedRevision === 0) {
        const existing = this.#prepare(
          "SELECT 1 FROM ordarium_state_revisions WHERE namespace = ? AND key = ? LIMIT 1",
        ).get(namespace, key);
        if (existing !== undefined) {
          this.#commit();
          return false;
        }
      } else {
        const current = this.#prepare(`
          SELECT revision FROM ordarium_state_revisions
          WHERE namespace = ? AND key = ?
          ORDER BY revision DESC
          LIMIT 1
        `).get(namespace, key);
        if (current === undefined || this.#number(current.revision) !== expectedRevision) {
          this.#commit();
          return false;
        }
      }
      const serialized = JSON.stringify(next);
      this.#prepare(`
        INSERT INTO ordarium_state_revisions(namespace, key, revision, value_digest, written_at, record_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(next.namespace, next.key, next.revision, next.valueDigest, next.writtenAt, serialized);
      const insertRef = this.#prepare(`
        INSERT INTO ordarium_state_refs(ref_kind, ref_id, namespace, key, revision)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const ref of next.refs) {
        insertRef.run(ref.kind, ref.id, next.namespace, next.key, next.revision);
      }
      this.#commit();
      return true;
    } catch (error) {
      this.#rollback();
      throw mapSqliteFailure(error);
    }
  }

  async stateHistory(
    namespace: string,
    key: string,
    cursor?: string,
    limit?: number,
  ): Promise<StateRevisionPage> {
    this.#assertOpen();
    const after = cursor === undefined ? -1 : decodeHistoryCursor(cursor);
    const bound = Math.max(0, limit ?? DEFAULT_PAGE_LIMIT);
    const rows = this.#prepare(`
      SELECT namespace, key, revision, record_json
      FROM ordarium_state_revisions
      WHERE namespace = ? AND key = ? AND revision > ?
      ORDER BY revision ASC
      LIMIT ?
    `).all(namespace, key, after, bound + 1);
    const revisions = rows.map((row) => this.#parseStateRecord(row));
    const page = revisions.slice(0, bound);
    const last = page[page.length - 1];
    const nextCursor = revisions.length > bound && last !== undefined
      ? encodeCursor({ r: String(last.revision) })
      : undefined;
    return { revisions: page, ...(nextCursor === undefined ? {} : { nextCursor }) };
  }

  async listStatesReferencing(
    ref: StateRef,
    cursor?: string,
    limit?: number,
  ): Promise<StateRecordPage> {
    this.#assertOpen();
    const clauses = ["f.ref_kind = ?", "f.ref_id = ?"];
    const parameters: (number | string)[] = [ref.kind, ref.id];
    const after = cursor === undefined ? undefined : decodeStateSubjectRevisionCursor(cursor);
    if (after !== undefined) {
      clauses.push("(r.namespace > ? OR (r.namespace = ? AND (r.key > ? OR (r.key = ? AND r.revision > ?))))");
      parameters.push(after.n, after.n, after.k, after.k, after.r);
    }
    const bound = Math.max(0, limit ?? DEFAULT_PAGE_LIMIT);
    const rows = this.#prepare(`
      SELECT r.namespace, r.key, r.revision, r.record_json
      FROM ordarium_state_refs f
      JOIN ordarium_state_revisions r
        ON r.namespace = f.namespace AND r.key = f.key AND r.revision = f.revision
      WHERE ${clauses.join(" AND ")}
      ORDER BY r.namespace ASC, r.key ASC, r.revision ASC
      LIMIT ?
    `).all(...parameters, bound + 1);
    const parsed = rows.map((row) => ({ row, record: this.#parseStateRecord(row) }));
    const records = parsed.slice(0, bound).map((entry) => entry.record);
    const last = parsed[bound - 1];
    const nextCursor = rows.length > bound && last !== undefined
      ? encodeCursor({ s: `${last.row.namespace}\u0000${last.row.key}`, r: String(last.row.revision) })
      : undefined;
    return { records, ...(nextCursor === undefined ? {} : { nextCursor }) };
  }

  async listStates(filter: StateListFilter = {}, cursor?: string): Promise<StateRecordPage> {
    this.#assertOpen();
    const clauses = [
      "(namespace, key, revision) IN (" +
        "SELECT namespace, key, MAX(revision) FROM ordarium_state_revisions GROUP BY namespace, key)",
    ];
    const parameters: (number | string)[] = [];
    if (filter.namespace !== undefined) {
      clauses.push("namespace = ?");
      parameters.push(filter.namespace);
    }
    const after = cursor === undefined ? undefined : decodeStateSubjectCursor(cursor);
    if (after !== undefined) {
      clauses.push("(namespace > ? OR (namespace = ? AND key > ?))");
      parameters.push(after.n, after.n, after.k);
    }
    const bound = Math.max(0, filter.limit ?? DEFAULT_PAGE_LIMIT);
    const rows = this.#prepare(`
      SELECT namespace, key, revision, record_json
      FROM ordarium_state_revisions
      WHERE ${clauses.join(" AND ")}
      ORDER BY namespace ASC, key ASC
      LIMIT ?
    `).all(...parameters, bound + 1);
    const records = rows.slice(0, bound).map((row) => this.#parseStateRecord(row));
    const lastRow = rows[bound - 1];
    const nextCursor = rows.length > bound && lastRow !== undefined
      ? encodeCursor({ s: `${lastRow.namespace}\u0000${lastRow.key}` })
      : undefined;
    return { records, ...(nextCursor === undefined ? {} : { nextCursor }) };
  }

  close(): void {
    if (!this.#closed) {
      this.#database.close();
      this.#closed = true;
    }
  }

  /**
   * One-shot transactional forward migration from the private v1 layout
   * (G2 design spec §3, G2-A01/A02). The migration body lives in
   * migrations.ts and throws raw; this wrapper owns the rollback and the
   * stable error-family mapping, so BUSY keeps crossing into the open
   * retry loop (G16) and everything else stays fail-closed.
   */
  #migrateFromV1(): void {
    try {
      migrateFromV1(this.#database);
    } catch (error) {
      this.#rollback();
      const mapped = error instanceof OrdariumError ? error : mapSqliteFailure(error);
      if (
        mapped instanceof LedgerBusyError ||
        mapped instanceof LedgerNewerSchemaError ||
        mapped instanceof LedgerMigrationFailedError
      ) {
        throw mapped;
      }
      throw new LedgerMigrationFailedError(describe(error));
    }
  }

  /**
   * Additive v2 -> v3 migration (G11 design spec §4). The migration body
   * lives in migrations.ts and throws raw; the wrapper owns rollback and
   * error-family mapping exactly like #migrateFromV1.
   */
  #migrateFromV2(): void {
    try {
      migrateFromV2(this.#database);
    } catch (error) {
      this.#rollback();
      const mapped = error instanceof OrdariumError ? error : mapSqliteFailure(error);
      if (
        mapped instanceof LedgerBusyError ||
        mapped instanceof LedgerNewerSchemaError ||
        mapped instanceof LedgerMigrationFailedError
      ) {
        throw mapped;
      }
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

  /**
   * Decode a state row through the single core codec and verify the row
   * columns against the decoded record, so persisted damage fails closed as
   * LEDGER_CORRUPT instead of surfacing as altered management state.
   */
  #parseStateRecord(row: Record<string, unknown>): StateRecord {
    let record: StateRecord;
    try {
      record = decodeStateRecord(JSON.parse(this.#string(row.record_json)));
    } catch (error) {
      if (error instanceof LedgerCorruptError) throw error;
      throw new LedgerCorruptError();
    }
    if (
      (row.namespace !== undefined && row.namespace !== record.namespace) ||
      (row.key !== undefined && row.key !== record.key) ||
      (row.revision !== undefined && row.revision !== record.revision)
    ) {
      throw new LedgerCorruptError();
    }
    return record;
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

  #assertOpen(): void {
    if (this.#closed) {
      throw new LedgerClosedError();
    }
  }
}

function resolveOpenRetry(
  openRetry: SqliteLedgerOpenRetry | undefined,
): { attempts: number; delayMs: number } {
  if (openRetry === undefined) return { attempts: 5, delayMs: 100 };
  if (typeof openRetry !== "object" || Array.isArray(openRetry)) {
    throw new TypeError("openRetry must be an object");
  }
  const attempts = openRetry.attempts ?? 5;
  const delayMs = openRetry.delayMs ?? 100;
  if (!Number.isSafeInteger(attempts) || attempts < 1) {
    throw new TypeError("openRetry.attempts must be a safe integer >= 1");
  }
  if (!Number.isSafeInteger(delayMs) || delayMs < 0) {
    throw new TypeError("openRetry.delayMs must be a safe integer >= 0");
  }
  return { attempts, delayMs };
}

function sleepSync(ms: number): void {
  if (ms === 0) return;
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      // Bounded spin fallback for runtimes that disallow Atomics.wait.
    }
  }
}

function mapSqliteFailure(error: unknown): Error {
  const code = (error as { code?: string }).code ?? "";
  const errstr = (error as { errstr?: string }).errstr ?? "";
  const message = error instanceof Error ? error.message : String(error);
  if (
    code.includes("SQLITE_BUSY") ||
    code.includes("SQLITE_LOCKED") ||
    errstr.includes("SQLITE_BUSY") ||
    errstr.includes("SQLITE_LOCKED") ||
    /database is locked|database table is locked/iu.test(message)
  ) {
    return new LedgerBusyError();
  }
  if (
    code.includes("SQLITE_CORRUPT") ||
    code.includes("SQLITE_NOTADB") ||
    errstr.includes("SQLITE_CORRUPT") ||
    errstr.includes("SQLITE_NOTADB") ||
    /malformed|file is not a database/iu.test(message)
  ) {
    return new LedgerCorruptError();
  }
  if (
    code.includes("SQLITE_FULL") ||
    errstr.includes("SQLITE_FULL") ||
    /database or disk is full/iu.test(message)
  ) {
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

function decodeStateSubjectCursor(cursor: string): { n: string; k: string } {
  const payload = decodeCursorPayload(cursor);
  if (typeof payload.s !== "string") throw new LedgerCorruptError();
  const separator = payload.s.indexOf("\u0000");
  if (separator <= 0) throw new LedgerCorruptError();
  return { n: payload.s.slice(0, separator), k: payload.s.slice(separator + 1) };
}

function decodeStateSubjectRevisionCursor(cursor: string): { n: string; k: string; r: number } {
  const payload = decodeCursorPayload(cursor);
  const revision = Number(payload.r);
  if (typeof payload.s !== "string" || !Number.isSafeInteger(revision) || revision < 0) {
    throw new LedgerCorruptError();
  }
  const separator = payload.s.indexOf("\u0000");
  if (separator <= 0) throw new LedgerCorruptError();
  return { n: payload.s.slice(0, separator), k: payload.s.slice(separator + 1), r: revision };
}
