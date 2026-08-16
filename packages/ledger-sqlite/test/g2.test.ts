import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import {
  LedgerBusyError,
  LedgerMigrationFailedError,
  LedgerNewerSchemaError,
  LedgerOpenFailedError,
  MemoryLedger,
  OperationBusyError,
  OrdariumRuntime,
  UncertainOperationError,
  defineAction,
  defineSchema,
  effects,
  type OperationLedger,
  type OperationRecord,
} from "@ordarium/core";
import { afterEach, describe, expect, it } from "vitest";

import { SqliteLedger } from "../src/index.js";

const text = defineSchema<string>({ type: "string" }, (value) => {
  if (typeof value !== "string") throw new TypeError("expected string");
  return value;
});
const allow = { decision: "allow", kind: "policy-decision", source: "g2" } as const;

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function freshDb(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), `ordarium-${prefix}-`));
  directories.push(directory);
  return join(directory, "operations.sqlite");
}

function guardedAction(name: string, executions: { count: number }, hold?: () => Promise<void>) {
  return defineAction({
    name,
    version: "1",
    description: "G2 fixture action",
    input: text,
    output: text,
    effect: effects.guarded(),
    async execute(input) {
      executions.count += 1;
      if (hold !== undefined) await hold();
      return `done:${input}`;
    },
  });
}

/** Build a private-v1 database exactly as the pre-G2 layout stored it. */
function createV1Database(path: string, records: unknown[]): void {
  const raw = new DatabaseSync(path);
  try {
    raw.exec("PRAGMA application_id = 0x4f524441");
    raw.exec("PRAGMA user_version = 1");
    raw.exec(`
      CREATE TABLE ordarium_operations (
        operation_id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL,
        state TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        record_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE ordarium_operation_events (
        operation_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        state TEXT NOT NULL,
        at TEXT NOT NULL,
        record_json TEXT NOT NULL,
        PRIMARY KEY (operation_id, revision)
      ) STRICT;
    `);
    const insertOperation = raw.prepare(`
      INSERT INTO ordarium_operations(operation_id, revision, state, updated_at, record_json)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertEvent = raw.prepare(`
      INSERT INTO ordarium_operation_events(operation_id, revision, state, at, record_json)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const record of records) {
      const value = record as {
        operationId: string;
        revision: number;
        state: string;
        updatedAt: string;
      };
      insertOperation.run(
        value.operationId,
        value.revision,
        value.state,
        value.updatedAt,
        JSON.stringify(record),
      );
      insertEvent.run(
        value.operationId,
        value.revision,
        value.state,
        value.updatedAt,
        JSON.stringify(record),
      );
    }
  } finally {
    raw.close();
  }
}

function v1Succeeded(operationId: string): Record<string, unknown> {
  return {
    schemaVersion: 1,
    operationId,
    actionName: "legacy.write",
    actionVersion: "2",
    inputDigest: "1".repeat(64),
    logicalKeyDigest: "2".repeat(64),
    identity: { source: "dsh", scope: "legacy", callId: `call-${operationId.slice(-2)}` },
    guarantee: "idempotent",
    state: "succeeded",
    revision: 4,
    attempts: 1,
    lastFencingToken: 1,
    result: { legacy: true },
    createdAt: "2025-06-01T00:00:00.000Z",
    updatedAt: "2025-06-01T00:00:04.000Z",
  };
}

function v1Dispatched(operationId: string): Record<string, unknown> {
  return {
    schemaVersion: 1,
    operationId,
    actionName: "legacy.dispatched",
    actionVersion: "1",
    inputDigest: "3".repeat(64),
    logicalKeyDigest: "4".repeat(64),
    identity: { source: "dsh", scope: "legacy", callId: `call-${operationId.slice(-2)}` },
    guarantee: "guarded",
    state: "dispatched",
    revision: 3,
    attempts: 1,
    lastFencingToken: 3,
    resumeFrom: "dispatched",
    claim: { owner: "legacy-owner", expiresAt: "2025-06-01T00:00:30.000Z", fencingToken: 3 },
    createdAt: "2025-06-01T00:00:00.000Z",
    updatedAt: "2025-06-01T00:00:03.000Z",
  };
}

describe("G2 ledger platform", () => {
  it("migrates a v1 database transactionally and preserves the durable facts (G2-A01)", async () => {
    const path = freshDb("migrate");
    createV1Database(path, [v1Succeeded(`op_${"a".repeat(40)}`), v1Dispatched(`op_${"b".repeat(40)}`)]);

    const ledger = new SqliteLedger(path);
    try {
      const raw = new DatabaseSync(path);
      expect(raw.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 2 });
      raw.close();

      const succeeded = await ledger.get(`op_${"a".repeat(40)}`);
      expect(succeeded).toMatchObject({
        schemaVersion: 2,
        effectKind: "idempotent",
        idempotencyMode: "operation-key",
        state: "succeeded",
        semanticRevision: 4,
        attempts: 1,
        lastFencingToken: 1,
        result: { legacy: true },
      });

      const dispatched = await ledger.get(`op_${"b".repeat(40)}`);
      expect(dispatched).toMatchObject({
        state: "dispatched",
        semanticRevision: 3,
        lastFencingToken: 3,
        claim: { owner: "legacy-owner", fencingToken: 3 },
      });
      const lease = await ledger.lease(`op_${"b".repeat(40)}`);
      expect(lease).toMatchObject({
        owner: "legacy-owner",
        fencingToken: 3,
        expiresAt: "2025-06-01T00:00:30.000Z",
      });
      expect((await ledger.history(`op_${"a".repeat(40)}`)).events).toHaveLength(1);
    } finally {
      ledger.close();
    }
  });

  it("rolls the migration back and keeps v1 intact on failure (G2-A02)", async () => {
    const path = freshDb("migrate-fail");
    const corrupt = { ...v1Succeeded(`op_${"c".repeat(40)}`), schemaVersion: 7 };
    createV1Database(path, [corrupt]);

    let thrown: unknown;
    try {
      new SqliteLedger(path);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(LedgerMigrationFailedError);
    expect((thrown as { code?: string }).code).toBe("LEDGER_MIGRATION_FAILED");

    const raw = new DatabaseSync(path);
    try {
      expect(raw.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 1 });
      const columns = raw.prepare("PRAGMA table_info(ordarium_operations)").all() as { name: string }[];
      expect(columns.map((column) => column.name)).toContain("revision");
    } finally {
      raw.close();
    }
  });

  it("keeps semantic history frozen while heartbeats renew the lease (G2-A03)", async () => {
    const path = freshDb("heartbeat");
    const executions = { count: 0 };
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const didStart = new Promise<void>((resolve) => {
      started = resolve;
    });
    const action = guardedAction("g2.heartbeat", executions, async () => {
      started();
      await held;
    });
    const ledger = new SqliteLedger(path);
    const runtime = new OrdariumRuntime({ ledger, ownerId: "beat", leaseMs: 30, allowVolatileLedger: true });

    const running = action.run(runtime, "work", {
      identity: { source: "test", scope: "g2", callId: "call-1" },
      authorization: allow,
    });
    await didStart;
    await new Promise((resolve) => setTimeout(resolve, 80));

    const observer = new SqliteLedger(path);
    const [inFlight] = (await observer.list()).records;
    expect(inFlight?.state).toBe("dispatched");
    expect(inFlight?.semanticRevision).toBe(3);
    const liveLease = await observer.lease(inFlight!.operationId);
    expect(liveLease?.leaseRevision).toBeGreaterThan(1);

    release();
    await expect(running).resolves.toBe("done:work");
    expect((await ledger.history(inFlight!.operationId)).events).toHaveLength(5);
    expect((await ledger.get(inFlight!.operationId))?.semanticRevision).toBe(4);
    expect(await ledger.lease(inFlight!.operationId)).toBeUndefined();
    observer.close();
    await runtime.close();
  });

  it("rejects a stale owner's terminal write after a lease takeover (G2-A04)", async () => {
    const path = freshDb("takeover");
    const executions = { count: 0 };
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const didStart = new Promise<void>((resolve) => {
      started = resolve;
    });
    const action = guardedAction("g2.takeover", executions, async () => {
      started();
      await held;
    });
    const ledger = new SqliteLedger(path);
    const stale = new OrdariumRuntime({ ledger, ownerId: "stale", leaseMs: 60_000, allowVolatileLedger: true });
    const running = action.run(stale, "work", {
      identity: { source: "test", scope: "g2", callId: "call-1" },
      authorization: allow,
    });
    await didStart;

    // Simulate the owner stalling past its lease.
    const raw = new DatabaseSync(path);
    raw.prepare("UPDATE ordarium_operation_leases SET expires_at = ?").run("2000-01-01T00:00:00.000Z");
    raw.close();

    const takeover = new OrdariumRuntime({ ledger, ownerId: "takeover", allowVolatileLedger: true });
    await expect(action.run(takeover, "work", {
      identity: { source: "test", scope: "g2", callId: "call-1" },
      authorization: allow,
    })).rejects.toBeInstanceOf(UncertainOperationError);

    release();
    await expect(running).rejects.toBeInstanceOf(OperationBusyError);

    const [record] = (await ledger.list()).records;
    expect(record?.state).toBe("uncertain");
    expect(record?.lastFencingToken).toBeGreaterThanOrEqual(2);
    await stale.close();
    await takeover.close();
  });

  it("lets exactly one of two real node processes claim the operation (G2-A05)", async () => {
    const path = freshDb("dual-process");
    const ledger = new SqliteLedger(path);
    ledger.close();

    const worker = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures", "claim-worker.mjs");
    const run = (owner: string) =>
      new Promise<{ ok: boolean; code?: string }>((resolve, reject) => {
        const child = spawn(process.execPath, [worker, path, owner], { stdio: ["ignore", "pipe", "inherit"] });
        let output = "";
        child.stdout.on("data", (chunk) => {
          output += chunk;
        });
        child.on("error", reject);
        child.on("close", () => resolve(JSON.parse(output)));
      });

    const [first, second] = await Promise.all([run("process-a"), run("process-b")]);
    const outcomes = [first, second].sort((left, right) => Number(left.ok) - Number(right.ok));
    expect(outcomes[0]).toMatchObject({ ok: false, code: "OPERATION_BUSY" });
    expect(outcomes[1]).toMatchObject({ ok: true, result: "done:work" });

    const observer = new SqliteLedger(path);
    const [record] = (await observer.list()).records;
    expect(record?.state).toBe("succeeded");
    expect(record?.attempts).toBe(1);
    observer.close();
  });

  it("maps infrastructure failures to the stable error family (G2-A07)", async () => {
    const newer = freshDb("newer");
    const ledger = new SqliteLedger(newer);
    ledger.close();
    const raw = new DatabaseSync(newer);
    raw.exec("PRAGMA user_version = 99");
    raw.close();
    expect(() => new SqliteLedger(newer)).toThrow(LedgerNewerSchemaError);

    const foreign = freshDb("foreign");
    const foreignRaw = new DatabaseSync(foreign);
    foreignRaw.exec("PRAGMA application_id = 12345");
    foreignRaw.exec("CREATE TABLE other (id TEXT) STRICT");
    foreignRaw.close();
    expect(() => new SqliteLedger(foreign)).toThrow(LedgerOpenFailedError);

    const busyPath = freshDb("busy");
    const busyLedger = new SqliteLedger(busyPath, { timeoutMs: 150 });
    const holder = new DatabaseSync(busyPath);
    try {
      holder.exec("BEGIN IMMEDIATE");
      holder.prepare(
        "INSERT INTO ordarium_operation_leases(operation_id, owner, fencing_token, expires_at, lease_revision) VALUES ('op_x', 'h', 1, '2027-01-01T00:00:00.000Z', 1)",
      ).run();
      const record: OperationRecord = {
        schemaVersion: 2,
        operationId: "op_busy_probe",
        actionName: "g2.busy",
        actionVersion: "1",
        inputDigest: "5".repeat(64),
        logicalKeyDigest: "6".repeat(64),
        identity: { source: "test", scope: "g2", callId: "busy" },
        effectKind: "guarded",
        idempotencyMode: "none",
        state: "proposed",
        semanticRevision: 0,
        attempts: 0,
        lastFencingToken: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
      await expect(busyLedger.create(record)).rejects.toBeInstanceOf(LedgerBusyError);
    } finally {
      holder.exec("ROLLBACK");
      holder.close();
      busyLedger.close();
    }

    const closed = new SqliteLedger(freshDb("closed"));
    closed.close();
    await expect(closed.get("op_missing")).rejects.toMatchObject({ code: "LEDGER_CLOSED" });
  });

  it("paginates list and history identically across Memory and SQLite (G2-A06)", async () => {
    const memory = new MemoryLedger();
    const sqlitePath = freshDb("pages");
    const sqlite = new SqliteLedger(sqlitePath);
    const base = Date.parse("2026-01-01T00:00:00.000Z");

    for (let index = 0; index < 23; index += 1) {
      const updatedAt = new Date(base + index * 1_000).toISOString();
      const record: OperationRecord = {
        schemaVersion: 2,
        operationId: `op_page_${String(index).padStart(3, "0")}`,
        actionName: "g2.pages",
        actionVersion: "1",
        inputDigest: "7".repeat(64),
        logicalKeyDigest: "8".repeat(64),
        identity: { source: "test", scope: "g2", callId: `call-${index}` },
        effectKind: "read-only",
        idempotencyMode: "none",
        state: "succeeded",
        semanticRevision: 1,
        attempts: 1,
        lastFencingToken: 1,
        result: index,
        createdAt: updatedAt,
        updatedAt,
      };
      await memory.create(record);
      await sqlite.create(record);
    }

    const walk = async (ledger: OperationLedger): Promise<string[]> => {
      const seen: string[] = [];
      let cursor: string | undefined = undefined;
      do {
        const page = await ledger.list({ limit: 7 }, cursor);
        seen.push(...page.records.map((record) => record.operationId));
        cursor = page.nextCursor;
      } while (cursor !== undefined);
      return seen;
    };

    const memoryOrder = await walk(memory);
    const sqliteOrder = await walk(sqlite);
    expect(memoryOrder).toEqual(sqliteOrder);
    expect(new Set(memoryOrder).size).toBe(23);
    expect(memoryOrder).toEqual([...memoryOrder].sort().reverse());

    const memoryHistory = await memory.history("op_page_000", undefined, 1);
    const sqliteHistory = await sqlite.history("op_page_000", undefined, 1);
    expect(sqliteHistory.events.map((event) => event.semanticRevision))
      .toEqual(memoryHistory.events.map((event) => event.semanticRevision));
    sqlite.close();
  });

  it("backs up a WAL database consistently and reopens it (G2-A08)", async () => {
    const path = freshDb("backup");
    const ledger = new SqliteLedger(path);
    const executions = { count: 0 };
    const action = guardedAction("g2.backup", executions);
    const runtime = new OrdariumRuntime({ ledger, allowVolatileLedger: true });
    await action.run(runtime, "work", {
      identity: { source: "test", scope: "g2", callId: "call-1" },
      authorization: allow,
    });

    const raw = new DatabaseSync(path);
    raw.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    raw.close();
    const backupPath = join(dirnameOf(path), "backup.sqlite");
    copyFileSync(path, backupPath);

    const restored = new SqliteLedger(backupPath);
    const [record] = (await restored.list()).records;
    expect(record?.state).toBe("succeeded");
    expect((await restored.history(record!.operationId)).events).toHaveLength(5);
    restored.close();
    await runtime.close();
  });

  it("reconverges through the provider operation key after restoring an old backup (G2-A09)", async () => {
    const path = freshDb("restore");
    const created = new Map<string, string>();
    const skuSchema = defineSchema<{ sku: string }>(
      { type: "object", properties: { sku: { type: "string" } }, required: ["sku"] },
      (value) => {
        if (value === null || typeof value !== "object" || typeof (value as { sku?: unknown }).sku !== "string") {
          throw new TypeError("expected { sku: string }");
        }
        return value as { sku: string };
      },
    );
    const providerCreateCount = { count: 0 };
    const action = defineAction({
      name: "g2.restore",
      version: "1",
      description: "Idempotent provider keyed resupply",
      input: skuSchema,
      output: text,
      effect: effects.idempotent(),
      key: (input) => `sku:${input.sku}`,
      execute: (input) => {
        const existing = created.get(input.sku);
        if (existing !== undefined) return existing;
        providerCreateCount.count += 1;
        const id = `resource-${providerCreateCount.count}`;
        created.set(input.sku, id);
        return id;
      },
    });

    const runtime = new OrdariumRuntime({
      ledger: new SqliteLedger(path),
      allowVolatileLedger: true,
    });
    await action.run(runtime, { sku: "first" }, {
      identity: { source: "test", scope: "g2", callId: "call-1" },
      authorization: allow,
    });
    await runtime.close();

    const raw = new DatabaseSync(path);
    raw.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    raw.close();
    const backupPath = join(dirnameOf(path), "backup.sqlite");
    copyFileSync(path, backupPath);

    // Work continues after the backup point, then the old backup is restored.
    const secondRuntime = new OrdariumRuntime({
      ledger: new SqliteLedger(path),
      allowVolatileLedger: true,
    });
    await action.run(secondRuntime, { sku: "second" }, {
      identity: { source: "test", scope: "g2", callId: "call-2" },
      authorization: allow,
    });
    await secondRuntime.close();
    copyFileSync(backupPath, path);

    // The restored ledger lost the "second" identity; replaying the same
    // invocation reopens a fresh operation whose same operation key lets the
    // Provider fact converge instead of creating a second business effect.
    const replay = new OrdariumRuntime({
      ledger: new SqliteLedger(path),
      allowVolatileLedger: true,
    });
    await expect(action.run(replay, { sku: "second" }, {
      identity: { source: "test", scope: "g2", callId: "call-2" },
      authorization: allow,
    })).resolves.toBe("resource-2");
    expect(providerCreateCount.count).toBe(2);
    await replay.close();
  });

  it("shares one ledger across two hosts with converging keys and separate identities (G2-A12)", async () => {
    const path = freshDb("shared");
    const executions = { count: 0 };
    const skuSchema = defineSchema<{ sku: string }>(
      { type: "object", properties: { sku: { type: "string" } }, required: ["sku"] },
      (value) => {
        if (value === null || typeof value !== "object" || typeof (value as { sku?: unknown }).sku !== "string") {
          throw new TypeError("expected { sku: string }");
        }
        return value as { sku: string };
      },
    );
    const keyed = defineAction({
      name: "g2.shared-key",
      version: "1",
      description: "Business-keyed action across hosts",
      input: skuSchema,
      output: text,
      effect: effects.guarded(),
      key: (input) => `sku:${input.sku}`,
      execute: (input) => {
        executions.count += 1;
        return input.sku;
      },
    });
    const unkeyed = defineAction({
      name: "g2.shared-plain",
      version: "1",
      description: "Identity-keyed action across hosts",
      input: text,
      output: text,
      effect: effects.guarded(),
      execute: (input) => {
        executions.count += 1;
        return input;
      },
    });

    const dshRuntime = new OrdariumRuntime({
      ledger: new SqliteLedger(path),
      allowVolatileLedger: true,
    });
    const mcpRuntime = new OrdariumRuntime({
      ledger: new SqliteLedger(path),
      allowVolatileLedger: true,
    });

    await keyed.run(dshRuntime, { sku: "same" }, {
      identity: { source: "dsh", scope: "dsh-session", callId: "dsh-call-1" },
      authorization: allow,
    });
    await keyed.run(mcpRuntime, { sku: "same" }, {
      identity: { source: "mcp", scope: "mcp-client", callId: "mcp-call-1" },
      authorization: allow,
    });
    expect(executions.count).toBe(1);
    const keyedRecords = (await dshRuntime.ledger.list({ actionName: "g2.shared-key" })).records;
    expect(keyedRecords).toHaveLength(1);

    await unkeyed.run(dshRuntime, "work", {
      identity: { source: "dsh", scope: "dsh-session", callId: "dsh-call-2" },
      authorization: allow,
    });
    await unkeyed.run(mcpRuntime, "work", {
      identity: { source: "mcp", scope: "mcp-client", callId: "mcp-call-2" },
      authorization: allow,
    });
    const plainRecords = (await dshRuntime.ledger.list({ actionName: "g2.shared-plain" })).records;
    expect(plainRecords).toHaveLength(2);
    expect(new Set(plainRecords.map((record) => record.identity.source))).toEqual(new Set(["dsh", "mcp"]));

    await dshRuntime.close();
    await mcpRuntime.close();
  });
});

function dirnameOf(path: string): string {
  const separator = path.lastIndexOf("/") > path.lastIndexOf("\\") ? "/" : "\\";
  return path.slice(0, path.lastIndexOf(separator));
}
