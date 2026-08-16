import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { decodeOperationRecord } from "@ordarium/core";
import type {
  OperationEvent,
  OperationLedger,
  OperationListFilter,
  OperationRecord,
  OperationState,
} from "@ordarium/core";

const APPLICATION_ID = 0x4f524441; // ASCII "ORDA"
const LEDGER_SCHEMA_VERSION = 1;

export interface SqliteLedgerOptions {
  timeoutMs?: number | undefined;
}

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
  #closed = false;

  constructor(path: string, options: SqliteLedgerOptions = {}) {
    this.path = path === ":memory:" ? path : resolve(path);
    if (this.path !== ":memory:") {
      mkdirSync(dirname(this.path), { recursive: true });
    }
    this.#database = new DatabaseSync(this.path, {
      timeout: options.timeoutMs ?? 5_000,
      enableForeignKeyConstraints: true,
    });
    this.#database.exec("PRAGMA journal_mode = WAL");
    this.#database.exec("PRAGMA synchronous = FULL");
    const applicationId = this.#pragmaNumber("application_id");
    if (applicationId !== 0 && applicationId !== APPLICATION_ID) {
      this.#database.close();
      this.#closed = true;
      throw new Error("SQLite file belongs to another application");
    }
    const schemaVersion = this.#pragmaNumber("user_version");
    if (schemaVersion > LEDGER_SCHEMA_VERSION) {
      this.#database.close();
      this.#closed = true;
      throw new Error(`Ordarium ledger schema ${schemaVersion} is newer than this runtime`);
    }
    if (applicationId === 0) this.#database.exec(`PRAGMA application_id = ${APPLICATION_ID}`);
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS ordarium_operations (
        operation_id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL,
        state TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        record_json TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS ordarium_operation_events (
        operation_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        state TEXT NOT NULL,
        at TEXT NOT NULL,
        record_json TEXT NOT NULL,
        PRIMARY KEY (operation_id, revision),
        FOREIGN KEY (operation_id) REFERENCES ordarium_operations(operation_id)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS ordarium_operations_state_idx
        ON ordarium_operations(state, updated_at DESC);
    `);
    if (schemaVersion === 0) {
      this.#database.exec(`PRAGMA user_version = ${LEDGER_SCHEMA_VERSION}`);
    }
  }

  async get(operationId: string): Promise<OperationRecord | undefined> {
    this.#assertOpen();
    const row = this.#database
      .prepare("SELECT record_json FROM ordarium_operations WHERE operation_id = ?")
      .get(operationId);
    return row === undefined ? undefined : this.#parseRecord(row.record_json);
  }

  async create(record: OperationRecord): Promise<{ created: boolean; record: OperationRecord }> {
    this.#assertOpen();
    decodeOperationRecord(record);
    this.#begin();
    try {
      const current = this.#database
        .prepare("SELECT record_json FROM ordarium_operations WHERE operation_id = ?")
        .get(record.operationId);
      if (current !== undefined) {
        this.#commit();
        return { created: false, record: this.#parseRecord(current.record_json) };
      }

      const serialized = JSON.stringify(record);
      this.#database.prepare(`
        INSERT INTO ordarium_operations(operation_id, revision, state, updated_at, record_json)
        VALUES (?, ?, ?, ?, ?)
      `).run(record.operationId, record.revision, record.state, record.updatedAt, serialized);
      this.#insertEvent(record, serialized);
      this.#commit();
      return { created: true, record: structuredClone(record) };
    } catch (error) {
      this.#rollback();
      throw error;
    }
  }

  async compareAndSet(
    operationId: string,
    expectedRevision: number,
    next: OperationRecord,
  ): Promise<boolean> {
    this.#assertOpen();
    if (next.operationId !== operationId || next.revision !== expectedRevision + 1) {
      return false;
    }
    decodeOperationRecord(next);

    this.#begin();
    try {
      const serialized = JSON.stringify(next);
      const result = this.#database.prepare(`
        UPDATE ordarium_operations
        SET revision = ?, state = ?, updated_at = ?, record_json = ?
        WHERE operation_id = ? AND revision = ?
      `).run(
        next.revision,
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
      this.#commit();
      return true;
    } catch (error) {
      this.#rollback();
      throw error;
    }
  }

  async history(operationId: string): Promise<OperationEvent[]> {
    this.#assertOpen();
    return this.#database.prepare(`
      SELECT operation_id, revision, state, at, record_json
      FROM ordarium_operation_events
      WHERE operation_id = ?
      ORDER BY revision ASC
    `).all(operationId).map((row) => {
      const record = this.#parseRecord(row.record_json);
      const revision = this.#number(row.revision);
      const state = this.#string(row.state) as OperationState;
      if (record.operationId !== this.#string(row.operation_id) ||
          record.revision !== revision || record.state !== state) {
        throw new Error("Ordarium operation event does not match its record snapshot");
      }
      return {
        operationId: record.operationId,
        revision,
        state,
        at: this.#string(row.at),
        record,
      };
    });
  }

  async list(filter: OperationListFilter = {}): Promise<OperationRecord[]> {
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
    const limit = Math.max(0, filter.limit ?? 100);
    parameters.push(limit);
    const where = clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`;
    const rows = this.#database.prepare(`
      SELECT record_json
      FROM ordarium_operations
      ${where}
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(...parameters);
    return rows.map((row) => this.#parseRecord(row.record_json));
  }

  close(): void {
    if (!this.#closed) {
      this.#database.close();
      this.#closed = true;
    }
  }

  #insertEvent(record: OperationRecord, serialized: string): void {
    this.#database.prepare(`
      INSERT INTO ordarium_operation_events(operation_id, revision, state, at, record_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(record.operationId, record.revision, record.state, record.updatedAt, serialized);
  }

  #parseRecord(value: unknown): OperationRecord {
    return decodeOperationRecord(JSON.parse(this.#string(value)));
  }

  #string(value: unknown): string {
    if (typeof value !== "string") {
      throw new TypeError("Ordarium SQLite row contains a non-string field");
    }
    return value;
  }

  #number(value: unknown): number {
    if (typeof value !== "number") {
      throw new TypeError("Ordarium SQLite row contains a non-number field");
    }
    return value;
  }

  #pragmaNumber(name: "application_id" | "user_version"): number {
    const row = this.#database.prepare(`PRAGMA ${name}`).get();
    if (row === undefined) throw new Error(`Unable to read SQLite PRAGMA ${name}`);
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
      throw new Error("SqliteLedger is closed");
    }
  }
}
