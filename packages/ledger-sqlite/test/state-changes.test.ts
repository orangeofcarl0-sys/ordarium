import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import {
  InvalidCursorError,
  LedgerMigrationFailedError,
  RESOURCE_LIMITS,
  createStateStore,
  digestJson,
  type InvocationIdentity,
  type JsonValue,
  type OrdariumStateStore,
  type StateRecord,
  type StateRef,
} from "@ordarium/core";
import { afterEach, describe, expect, it } from "vitest";

import { SqliteLedger } from "../src/index.js";

const directories: string[] = [];
const identity: InvocationIdentity = { source: "test", scope: "scf", callId: "call-1" };

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function freshPath(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), `ordarium-${prefix}-`));
  directories.push(directory);
  return join(directory, "operations.sqlite");
}

function stateRecord(
  namespace: string,
  key: string,
  revision: number,
  value: JsonValue,
  refs: StateRef[] = [],
): StateRecord {
  return {
    schemaVersion: 1,
    namespace,
    key,
    revision,
    value,
    valueDigest: digestJson(value),
    refs,
    identity,
    writtenAt: "2026-01-01T00:00:00.000Z",
  };
}

function label(record: StateRecord): string {
  return `${record.namespace}/${record.key}@${record.revision}`;
}

function store(ledger: SqliteLedger): OrdariumStateStore {
  return createStateStore({ ledger });
}

async function write(
  target: OrdariumStateStore,
  namespace: string,
  key: string,
  value: JsonValue,
  expectedRevision: number,
): Promise<StateRecord> {
  return target.write({ namespace, key, expectedRevision, value, identity });
}

async function drain(
  ledger: SqliteLedger,
  limit?: number,
  namespace?: string,
): Promise<StateRecord[]> {
  const seen: StateRecord[] = [];
  let cursor: string | undefined = undefined;
  let page = await ledger.changes(
    namespace === undefined ? { limit } : { limit, namespace },
    cursor,
  );
  seen.push(...page.changes);
  while (page.hasMore) {
    cursor = page.cursor;
    page = await ledger.changes(
      namespace === undefined ? { limit } : { limit, namespace },
      cursor,
    );
    seen.push(...page.changes);
  }
  return seen;
}

async function runWriter(
  args: string[],
): Promise<{ ok: boolean; revision?: number; code?: string }> {
  const worker = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures", "state-change-writer.mjs");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker, ...args], { stdio: ["ignore", "pipe", "inherit"] });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", reject);
    child.on("close", () => {
      try {
        resolve(JSON.parse(output));
      } catch (error) {
        reject(error);
      }
    });
  });
}

/** Build a real v3 database (pre-feed layout) for the migration tests. */
function createV3Database(path: string, revisions: StateRecord[]): void {
  const raw = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  try {
    raw.exec("PRAGMA application_id = 0x4f524441");
    raw.exec("PRAGMA user_version = 3");
    raw.exec(`
      CREATE TABLE ordarium_operations (
        operation_id TEXT PRIMARY KEY,
        semantic_revision INTEGER NOT NULL,
        state TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        record_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE ordarium_operation_events (
        operation_id TEXT NOT NULL,
        semantic_revision INTEGER NOT NULL,
        state TEXT NOT NULL,
        at TEXT NOT NULL,
        record_json TEXT NOT NULL,
        PRIMARY KEY (operation_id, semantic_revision),
        FOREIGN KEY (operation_id) REFERENCES ordarium_operations(operation_id)
      ) STRICT;
      CREATE TABLE ordarium_operation_leases (
        operation_id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        fencing_token INTEGER NOT NULL,
        expires_at TEXT NOT NULL,
        lease_revision INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE ordarium_state_revisions (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        revision INTEGER NOT NULL,
        value_digest TEXT NOT NULL,
        written_at TEXT NOT NULL,
        record_json TEXT NOT NULL,
        PRIMARY KEY (namespace, key, revision)
      ) STRICT;
      CREATE TABLE ordarium_state_refs (
        ref_kind TEXT NOT NULL,
        ref_id TEXT NOT NULL,
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        revision INTEGER NOT NULL,
        PRIMARY KEY (ref_kind, ref_id, namespace, key, revision),
        FOREIGN KEY (namespace, key, revision)
          REFERENCES ordarium_state_revisions(namespace, key, revision)
      ) STRICT;
    `);
    const insertRevision = raw.prepare(`
      INSERT INTO ordarium_state_revisions(namespace, key, revision, value_digest, written_at, record_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertRef = raw.prepare(`
      INSERT INTO ordarium_state_refs(ref_kind, ref_id, namespace, key, revision)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const record of revisions) {
      insertRevision.run(
        record.namespace,
        record.key,
        record.revision,
        record.valueDigest,
        record.writtenAt,
        JSON.stringify(record),
      );
    }
    for (const record of revisions) {
      for (const ref of record.refs) {
        insertRef.run(ref.kind, ref.id, record.namespace, record.key, record.revision);
      }
    }
  } finally {
    raw.close();
  }
}

describe("ORD-BOOT-0 state change feed (SqliteLedger)", () => {
  it("SCF-A01: observes every committed revision in durable commit order", async () => {
    const ledger = new SqliteLedger(freshPath("scf-a01"));
    try {
      const target = store(ledger);
      await write(target, "alpha", "one", { n: 1 }, 0);
      await write(target, "beta", "two", { n: 1 }, 0);
      await write(target, "alpha", "one", { n: 2 }, 1);

      const page = await ledger.changes(undefined, undefined);
      expect(page.changes.map(label)).toEqual(["alpha/one@1", "beta/two@1", "alpha/one@2"]);
      expect(page.hasMore).toBe(false);
      expect(typeof page.cursor).toBe("string");
      expect(page.changes[2]?.value).toEqual({ n: 2 });
    } finally {
      ledger.close();
    }
  });

  it("SCF-A02: paginates with no gaps, no duplicates and page-size invariance", async () => {
    const ledger = new SqliteLedger(freshPath("scf-a02"));
    try {
      const target = store(ledger);
      await write(target, "alpha", "one", { n: 1 }, 0);
      await write(target, "beta", "two", { n: 1 }, 0);
      await write(target, "alpha", "one", { n: 2 }, 1);
      await write(target, "beta", "two", { n: 2 }, 1);
      await write(target, "gamma", "three", { n: 1 }, 0);
      const expected = [
        "alpha/one@1",
        "beta/two@1",
        "alpha/one@2",
        "beta/two@2",
        "gamma/three@1",
      ];

      const one = await drain(ledger, 1);
      expect(one.map(label)).toEqual(expected);
      const two = await drain(ledger, 2);
      expect(two.map(label)).toEqual(expected);
      const all = await drain(ledger);
      expect(all.map(label)).toEqual(expected);
      expect(new Set(all.map(label)).size).toBe(5);

      // hasMore is honest per page.
      const first = await ledger.changes({ limit: 1 }, undefined);
      expect(first.hasMore).toBe(true);
      const last = await ledger.changes({ limit: 1 }, first.cursor);
      expect(last.hasMore).toBe(true);
    } finally {
      ledger.close();
    }
  });

  it("SCF-A03: a caught-up cursor observes a revision committed later", async () => {
    const ledger = new SqliteLedger(freshPath("scf-a03"));
    try {
      const target = store(ledger);
      await write(target, "alpha", "one", { n: 1 }, 0);

      const caughtUp = await drain(ledger, 1);
      expect(caughtUp.map(label)).toEqual(["alpha/one@1"]);
      const edge = await ledger.changes(undefined, (await ledger.changes(undefined, undefined)).cursor);
      expect(edge.changes).toEqual([]);
      expect(edge.hasMore).toBe(false);

      await write(target, "alpha", "one", { n: 2 }, 1);
      const resumed = await ledger.changes(undefined, edge.cursor);
      expect(resumed.changes.map(label)).toEqual(["alpha/one@2"]);
    } finally {
      ledger.close();
    }
  });

  it("SCF-A04: a cursor survives close and reopen of the same database", async () => {
    const path = freshPath("scf-a04");
    const first = new SqliteLedger(path);
    const target = store(first);
    await write(target, "alpha", "one", { n: 1 }, 0);
    await write(target, "alpha", "two", { n: 1 }, 0);
    const page = await first.changes({ limit: 1 }, undefined);
    expect(page.changes.map(label)).toEqual(["alpha/one@1"]);
    const persisted = page.cursor;
    first.close();

    const reopened = new SqliteLedger(path);
    try {
      await write(store(reopened), "alpha", "three", { n: 1 }, 0);
      const resumed = await drain(reopened);
      expect(resumed.map(label)).toEqual(["alpha/one@1", "alpha/two@1", "alpha/three@1"]);
      const afterCursor = await reopened.changes(undefined, persisted);
      expect(afterCursor.changes.map(label)).toEqual(["alpha/two@1", "alpha/three@1"]);
    } finally {
      reopened.close();
    }
  });

  it("SCF-A05: two independent ledger handles commit against one database", async () => {
    const path = freshPath("scf-a05");
    const writerA = new SqliteLedger(path);
    const writerB = new SqliteLedger(path);
    try {
      const targetA = store(writerA);
      const targetB = store(writerB);
      await write(targetA, "alpha", "one", { n: 1 }, 0);
      await write(targetB, "beta", "two", { n: 1 }, 0);
      await write(targetA, "alpha", "one", { n: 2 }, 1);

      const reader = new SqliteLedger(path);
      try {
        const observed = await drain(reader);
        expect(observed.map(label)).toEqual(["alpha/one@1", "beta/two@1", "alpha/one@2"]);
      } finally {
        reader.close();
      }
    } finally {
      writerA.close();
      writerB.close();
    }
  });

  it("SCF-A05 process variant: two real node processes commit and stay observable", async () => {
    const path = freshPath("scf-a05p");
    const bootstrap = new SqliteLedger(path);
    bootstrap.close();

    const outcomes = await Promise.all([
      runWriter([path, "alpha", "one"]),
      runWriter([path, "beta", "two"]),
    ]);
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);

    const reader = new SqliteLedger(path);
    try {
      const observed = await drain(reader);
      expect(observed.map(label).sort()).toEqual(["alpha/one@1", "beta/two@1"]);
    } finally {
      reader.close();
    }
  });

  it("SCF-A06: a failed CAS leaves no feed ghost", async () => {
    const path = freshPath("scf-a06");
    const ledger = new SqliteLedger(path);
    try {
      const target = store(ledger);
      await write(target, "alpha", "one", { n: 1 }, 0);

      // A and B both observe revision 1, then race the same CAS target.
      const seenByA = await ledger.getState("alpha", "one");
      const seenByB = await ledger.getState("alpha", "one");
      expect(seenByA?.revision).toBe(1);
      expect(seenByB?.revision).toBe(1);

      await expect(write(store(ledger), "alpha", "one", { n: 2 }, 1)).resolves.toMatchObject({
        revision: 2,
      });
      await expect(write(store(ledger), "alpha", "one", { n: 3 }, 1)).rejects.toMatchObject({
        code: "STATE_REVISION_CONFLICT",
      });

      const observed = await drain(ledger);
      expect(observed.map(label)).toEqual(["alpha/one@1", "alpha/one@2"]);
      expect(observed.filter((record) => record.revision === 3)).toEqual([]);
    } finally {
      ledger.close();
    }
  });

  it("SCF-A07: a namespace filter sees only its revisions with a global cursor", async () => {
    const ledger = new SqliteLedger(freshPath("scf-a07"));
    try {
      const target = store(ledger);
      await write(target, "alpha", "one", { n: 1 }, 0);
      await write(target, "beta", "two", { n: "secret" }, 0);
      await write(target, "alpha", "one", { n: 2 }, 1);

      const alpha = await drain(ledger, undefined, "alpha");
      expect(alpha.map(label)).toEqual(["alpha/one@1", "alpha/one@2"]);
      const beta = await drain(ledger, undefined, "beta");
      expect(beta.map(label)).toEqual(["beta/two@1"]);
      expect(JSON.stringify(beta)).not.toContain("alpha");

      // The cursor is a global position, independent of the filter (approach A).
      const firstAlpha = await ledger.changes({ namespace: "alpha", limit: 1 }, undefined);
      expect(firstAlpha.changes.map(label)).toEqual(["alpha/one@1"]);
      const betaFromSameCursor = await ledger.changes(
        { namespace: "beta", limit: 1 },
        firstAlpha.cursor,
      );
      expect(betaFromSameCursor.changes.map(label)).toEqual(["beta/two@1"]);
    } finally {
      ledger.close();
    }
  });

  it("SCF-A08: a malformed cursor fails closed instead of restarting at zero", async () => {
    const ledger = new SqliteLedger(freshPath("scf-a08"));
    try {
      await write(store(ledger), "alpha", "one", { n: 1 }, 0);
      const encode = (payload: unknown): string =>
        Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
      const malformed = [
        "%%%not-a-cursor%%%",
        encode([1, 2]),
        encode({ x: 1 }),
        encode({ c: 12 }),
        encode({ c: "1.5" }),
        encode({ c: "-1" }),
        encode({ c: "not-a-number" }),
      ];
      for (const cursor of malformed) {
        await expect(ledger.changes(undefined, cursor)).rejects.toBeInstanceOf(InvalidCursorError);
      }
      // Valid boundary cursors still work.
      const zero = await ledger.changes(undefined, encode({ c: "0" }));
      expect(zero.changes.map(label)).toEqual(["alpha/one@1"]);
    } finally {
      ledger.close();
    }
  });

  it("SCF-A09: migrates a real v3 database, preserves state truth and backfills order", async () => {
    const path = freshPath("scf-a09");
    const alphaOne = stateRecord("alpha", "one", 1, { n: 1 });
    const alphaTwo = stateRecord("alpha", "one", 2, { n: 2 }, [
      { kind: "state", id: "alpha/one@1" },
    ]);
    const betaOne = stateRecord("beta", "two", 1, { n: "beta" });
    // Deliberately out of alphabetical/commit order to prove deterministic backfill.
    createV3Database(path, [betaOne, alphaTwo, alphaOne]);

    const ledger = new SqliteLedger(path);
    try {
      const raw = new DatabaseSync(path);
      expect(raw.prepare("PRAGMA user_version").get()?.user_version).toBe(4);
      expect(
        raw.prepare("SELECT change_seq, namespace, key, revision FROM ordarium_state_changes ORDER BY change_seq").all(),
      ).toEqual([
        { change_seq: 1, namespace: "alpha", key: "one", revision: 1 },
        { change_seq: 2, namespace: "alpha", key: "one", revision: 2 },
        { change_seq: 3, namespace: "beta", key: "two", revision: 1 },
      ]);
      raw.close();

      // Pre-existing truth is byte/semantic-identical.
      expect(await ledger.getState("alpha", "one")).toEqual(alphaTwo);
      expect((await ledger.stateHistory("alpha", "one", undefined, 10)).revisions).toEqual([
        alphaOne,
        alphaTwo,
      ]);
      const referencing = await ledger.listStatesReferencing(
        { kind: "state", id: "alpha/one@1" },
        undefined,
        10,
      );
      expect(referencing.records.map(label)).toEqual(["alpha/one@2"]);

      // Deterministic migration order, explicitly not recovered commit order.
      const migrated = await drain(ledger);
      expect(migrated.map(label)).toEqual(["alpha/one@1", "alpha/one@2", "beta/two@1"]);

      // Post-migration commits continue with real durable order.
      await write(store(ledger), "gamma", "three", { n: 1 }, 0);
      const afterBackfill = await drain(ledger);
      expect(afterBackfill.map(label)).toEqual([
        "alpha/one@1",
        "alpha/one@2",
        "beta/two@1",
        "gamma/three@1",
      ]);
    } finally {
      ledger.close();
    }
  });

  it("SCF-A09 rollback: a failing v3 migration leaves an intact v3 database", () => {
    const path = freshPath("scf-a09r");
    createV3Database(path, [stateRecord("alpha", "one", 1, { n: 1 })]);
    const tamper = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    tamper.exec(`
      CREATE TABLE ordarium_state_changes (
        change_seq INTEGER PRIMARY KEY AUTOINCREMENT,
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        revision INTEGER NOT NULL,
        UNIQUE (namespace, key, revision),
        FOREIGN KEY (namespace, key, revision)
          REFERENCES ordarium_state_revisions(namespace, key, revision)
      ) STRICT
    `);
    tamper.prepare("INSERT INTO ordarium_state_changes(namespace, key, revision) VALUES ('alpha','one',1)").run();
    tamper.close();

    expect(() => new SqliteLedger(path)).toThrow(LedgerMigrationFailedError);
    const raw = new DatabaseSync(path);
    try {
      expect(raw.prepare("PRAGMA user_version").get()?.user_version).toBe(3);
      expect(raw.prepare("SELECT COUNT(*) AS count FROM ordarium_state_revisions").get()).toMatchObject({
        count: 1,
      });
    } finally {
      raw.close();
    }
  });

  it("SCF-A10: a committed revision survives an abrupt process exit; a rollback is invisible", async () => {
    const path = freshPath("scf-a10");
    const bootstrap = new SqliteLedger(path);
    bootstrap.close();

    const crashed = await runWriter([path, "alpha", "one", "crash"]);
    expect(crashed).toMatchObject({ ok: true, revision: 1 });

    const reader = new SqliteLedger(path);
    try {
      const observed = await drain(reader);
      expect(observed.map(label)).toEqual(["alpha/one@1"]);
    } finally {
      reader.close();
    }

    // An uncommitted mutation rolled back by the writer must leave nothing.
    const raw = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    try {
      raw.exec("BEGIN IMMEDIATE");
      raw
        .prepare(
          "INSERT INTO ordarium_state_revisions(namespace, key, revision, value_digest, written_at, record_json) VALUES (?,?,?,?,?,?)",
        )
        .run("ghost", "gone", 1, digestJson({ ghost: true }), "2026-01-01T00:00:00.000Z", JSON.stringify(stateRecord("ghost", "gone", 1, { ghost: true })));
      raw.prepare("INSERT INTO ordarium_state_changes(namespace, key, revision) VALUES ('ghost','gone',1)").run();
      raw.exec("ROLLBACK");
    } finally {
      raw.close();
    }
    const afterRollback = new SqliteLedger(path);
    try {
      expect((await drain(afterRollback)).map(label)).toEqual(["alpha/one@1"]);
      expect(await afterRollback.getState("ghost", "gone")).toBeUndefined();
    } finally {
      afterRollback.close();
    }
  });

  it("SCF-A10b: dangling ordering metadata surfaces as ledger corruption, not a skip", async () => {
    const path = freshPath("scf-a10c");
    const ledger = new SqliteLedger(path);
    try {
      await write(store(ledger), "alpha", "one", { n: 1 }, 0);
    } finally {
      ledger.close();
    }
    // Simulate external damage: remove the referenced revision while the
    // ordering row survives (foreign keys disabled on the tamper connection).
    const tamper = new DatabaseSync(path);
    tamper.exec("PRAGMA foreign_keys = OFF");
    tamper.exec("DELETE FROM ordarium_state_revisions WHERE namespace = 'alpha' AND key = 'one'");
    tamper.close();

    const reopened = new SqliteLedger(path);
    try {
      await expect(reopened.changes(undefined, undefined)).rejects.toMatchObject({
        code: "LEDGER_CORRUPT",
      });
    } finally {
      reopened.close();
    }
  });
});

function encodePosition(position: number): string {
  return Buffer.from(JSON.stringify({ c: String(position) }), "utf8").toString("base64url");
}

describe("ORD-BOOT-0.1 page/cursor hardening (SqliteLedger)", () => {
  it("SCF-B01: limit=0 is rejected (no deterministic livelock)", async () => {
    const ledger = new SqliteLedger(freshPath("scf-b01"));
    try {
      await write(store(ledger), "alpha", "one", { n: 1 }, 0);
      await expect(ledger.changes({ limit: 0 }, undefined)).rejects.toBeInstanceOf(TypeError);
    } finally {
      ledger.close();
    }
  });

  it("SCF-B02: limit=MAX is accepted", async () => {
    const ledger = new SqliteLedger(freshPath("scf-b02"));
    try {
      await write(store(ledger), "alpha", "one", { n: 1 }, 0);
      const page = await ledger.changes({ limit: RESOURCE_LIMITS.maxStateChangePageItems }, undefined);
      expect(page.changes.map(label)).toEqual(["alpha/one@1"]);
    } finally {
      ledger.close();
    }
  });

  it("SCF-B03: limit=MAX+1 is rejected", async () => {
    const ledger = new SqliteLedger(freshPath("scf-b03"));
    try {
      await write(store(ledger), "alpha", "one", { n: 1 }, 0);
      await expect(
        ledger.changes({ limit: RESOURCE_LIMITS.maxStateChangePageItems + 1 }, undefined),
      ).rejects.toBeInstanceOf(TypeError);
    } finally {
      ledger.close();
    }
  });

  it("SCF-B04: negative, fractional and unsafe limits are rejected", async () => {
    const ledger = new SqliteLedger(freshPath("scf-b04"));
    try {
      await write(store(ledger), "alpha", "one", { n: 1 }, 0);
      for (const limit of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
        await expect(ledger.changes({ limit }, undefined)).rejects.toBeInstanceOf(TypeError);
      }
    } finally {
      ledger.close();
    }
  });

  it("SCF-B05: a future cursor is refused instead of silently starving", async () => {
    const ledger = new SqliteLedger(freshPath("scf-b05"));
    try {
      const target = store(ledger);
      await write(target, "alpha", "one", { n: 1 }, 0);
      await write(target, "alpha", "two", { n: 1 }, 0);
      await write(target, "beta", "three", { n: 1 }, 0);
      await expect(ledger.changes(undefined, encodePosition(4))).rejects.toBeInstanceOf(
        InvalidCursorError,
      );
    } finally {
      ledger.close();
    }
  });

  it("SCF-B06: on an empty ledger cursor=0 is valid and cursor=1 is refused", async () => {
    const ledger = new SqliteLedger(freshPath("scf-b06"));
    try {
      expect((await ledger.changes(undefined, encodePosition(0))).changes).toEqual([]);
      await expect(ledger.changes(undefined, encodePosition(1))).rejects.toBeInstanceOf(
        InvalidCursorError,
      );
    } finally {
      ledger.close();
    }
  });

  it("SCF-B07: the current high-water is a valid caught-up cursor and observes N+1", async () => {
    const ledger = new SqliteLedger(freshPath("scf-b07"));
    try {
      const target = store(ledger);
      await write(target, "alpha", "one", { n: 1 }, 0);
      await write(target, "alpha", "two", { n: 1 }, 0);
      const atWater = await ledger.changes(undefined, encodePosition(2));
      expect(atWater.changes).toEqual([]);
      expect(atWater.hasMore).toBe(false);
      await write(target, "beta", "three", { n: 3 }, 0);
      const observed = await ledger.changes(undefined, atWater.cursor);
      expect(observed.changes.map(label)).toEqual(["beta/three@1"]);
    } finally {
      ledger.close();
    }
  });

  it("SCF-B08: a cursor from a higher-water database is refused after restore/reset", async () => {
    const high = new SqliteLedger(freshPath("scf-b08-hi"));
    await write(store(high), "alpha", "one", { n: 1 }, 0);
    await write(store(high), "alpha", "two", { n: 1 }, 0);
    await write(store(high), "alpha", "three", { n: 1 }, 0);
    const cursor = (await high.changes(undefined, undefined)).cursor;
    high.close();

    const low = new SqliteLedger(freshPath("scf-b08-lo"));
    try {
      await write(store(low), "beta", "one", { n: 1 }, 0);
      await expect(low.changes(undefined, cursor)).rejects.toBeInstanceOf(InvalidCursorError);
    } finally {
      low.close();
    }
  });

  it("SCF-B09: future-cursor validation uses the global high-water, not the namespace max", async () => {
    const ledger = new SqliteLedger(freshPath("scf-b09"));
    try {
      const target = store(ledger);
      for (const key of ["a1", "a2", "a3", "a4"]) {
        await write(target, "alpha", key, { key }, 0);
      }
      for (const key of ["b5", "b6", "b7", "b8", "b9", "b10"]) {
        await write(target, "beta", key, { key }, 0);
      }
      const filtered = await ledger.changes({ namespace: "alpha" }, encodePosition(8));
      expect(filtered.changes).toEqual([]);
      await write(target, "alpha", "a11", { key: "a11" }, 0);
      const observed = await ledger.changes({ namespace: "alpha" }, encodePosition(8));
      expect(observed.changes.map(label)).toEqual(["alpha/a11@1"]);
    } finally {
      ledger.close();
    }
  });
});
