import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { OrdariumError, type OperationRecord } from "@ordarium/core";
import { afterEach, describe, expect, it } from "vitest";

import { SqliteLedger } from "../src/index.js";

const directories: string[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    child.kill();
  }
  // Killed holders release their file handles asynchronously; give Windows a
  // short grace period before reclaiming the temp directories.
  await wait(150);
  for (const directory of directories.splice(0)) {
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch {
      // The OS reclaims the tmp directory even if a handle lingers.
    }
  }
});

const fixtureOperationId = `op_${"0".repeat(40)}`;

async function createV2DatabaseWithOperation(): Promise<{
  path: string;
  before: OperationRecord;
}> {
  const directory = mkdtempSync(join(tmpdir(), "ordarium-g16-"));
  directories.push(directory);
  const path = join(directory, "operations.sqlite");
  const ledger = new SqliteLedger(path);
  await ledger.create({
    schemaVersion: 2,
    operationId: fixtureOperationId,
    actionName: "g16.fixture",
    actionVersion: "1",
    inputDigest: "a".repeat(64),
    logicalKeyDigest: "b".repeat(64),
    identity: { source: "g16", scope: "open-retry", callId: "call-1" },
    effectKind: "idempotent",
    idempotencyMode: "operation-key",
    state: "proposed",
    semanticRevision: 0,
    attempts: 0,
    lastFencingToken: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  const before = (await ledger.get(fixtureOperationId))!;
  ledger.close();
  const raw = new DatabaseSync(path);
  raw.exec("DROP TABLE ordarium_state_refs");
  raw.exec("DROP TABLE ordarium_state_revisions");
  raw.exec("PRAGMA user_version = 2");
  raw.close();
  return { path, before };
}

/**
 * Spawns a child process that holds the database write lock (BEGIN
 * IMMEDIATE) and releases it after `holdMs`. The parent thread blocks inside
 * the SqliteLedger constructor, so the release must happen from a separate
 * process for the retry loop to observe it.
 */
function spawnLockHolder(path: string, holdMs: number): void {
  const child = spawn(
    process.execPath,
    [
      "-e",
      `
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(process.argv[1], { timeout: 50 });
      db.exec("BEGIN IMMEDIATE");
      db.exec("CREATE TABLE IF NOT EXISTS g16_lock_holder(x)");
      db.exec("INSERT INTO g16_lock_holder VALUES (1)");
      setTimeout(() => {
        try { db.exec("COMMIT"); } catch {}
        db.close();
        process.exit(0);
      }, ${holdMs});
      setInterval(() => {}, 50);
      `,
      path,
    ],
    { stdio: "ignore" },
  );
  child.unref();
  children.push(child);
}

/**
 * Polls until a foreign connection provably holds the database write lock: a
 * zero-busy-timeout BEGIN IMMEDIATE failing is the confirmation. Waiting a
 * fixed head start instead is a race - Node boot time varies with load, and
 * constructing before the lock exists would let the first attempt succeed
 * without ever exercising the retry loop.
 */
async function waitForWriteLock(path: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    let probe: DatabaseSync | undefined;
    try {
      probe = new DatabaseSync(path);
      probe.exec("PRAGMA busy_timeout = 0");
      probe.exec("BEGIN IMMEDIATE");
      probe.exec("COMMIT");
      probe.close();
      await wait(20);
    } catch {
      probe?.close();
      return;
    }
  }
  throw new Error("lock holder never acquired the write lock within 5s");
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

describe("SqliteLedger open retry (G16)", () => {
  it("succeeds within the default bounded backoff when the holder releases (G16-A01)", async () => {
    const { path, before } = await createV2DatabaseWithOperation();
    spawnLockHolder(path, 300);
    await waitForWriteLock(path);

    // A small busy timeout forces each attempt to surface LEDGER_BUSY, so
    // the constructor's own retry loop - not sqlite's busy_timeout - has to
    // carry the open across the release boundary. The release (~300ms) must
    // land inside the default retry horizon: its floor is the four 100ms
    // backoff sleeps alone (400ms) even if every attempt failed instantly,
    // and its realistic span (each attempt blocked ~100ms by the busy
    // timeout) is ~900ms - so the first attempt fails and at least one
    // backoff sleep passes before a retry can succeed, on any platform.
    const started = Date.now();
    const ledger = new SqliteLedger(path, { timeoutMs: 100 });
    const elapsed = Date.now() - started;
    try {
      expect(elapsed).toBeGreaterThanOrEqual(200);
      expect(elapsed).toBeLessThan(5_000);
      const raw = new DatabaseSync(path);
      expect(raw.prepare("PRAGMA user_version").get()?.user_version).toBe(3);
      raw.close();
      expect(await ledger.get(fixtureOperationId)).toEqual(before);
    } finally {
      ledger.close();
    }
  });

  it("attempts: 1 restores the fail-fast semantics (G16-A02)", async () => {
    const { path } = await createV2DatabaseWithOperation();
    spawnLockHolder(path, 2_000);
    await waitForWriteLock(path);

    const started = Date.now();
    expect(() => new SqliteLedger(path, { timeoutMs: 100, openRetry: { attempts: 1 } }))
      .toThrowError(expect.objectContaining({ code: "LEDGER_BUSY" }));
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  it("never retries non-busy open failures (G16-A03)", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ordarium-g16-"));
    directories.push(directory);

    const corruptPath = join(directory, "corrupt.sqlite");
    writeFileSync(corruptPath, "this is not a sqlite database\n".repeat(40));
    const corruptStarted = Date.now();
    expect(() => new SqliteLedger(corruptPath, { openRetry: { attempts: 5, delayMs: 100 } }))
      .toThrowError(expect.objectContaining({ code: "LEDGER_CORRUPT" }));
    expect(Date.now() - corruptStarted).toBeLessThan(300);

    const newerPath = join(directory, "newer.sqlite");
    const raw = new DatabaseSync(newerPath);
    raw.exec("PRAGMA user_version = 99");
    raw.close();
    const newerStarted = Date.now();
    expect(() => new SqliteLedger(newerPath, { openRetry: { attempts: 5, delayMs: 100 } }))
      .toThrowError(expect.objectContaining({ code: "LEDGER_NEWER_SCHEMA" }));
    expect(Date.now() - newerStarted).toBeLessThan(300);
  });

  it("rejects invalid openRetry configurations with a TypeError (G16-A04)", () => {
    const directory = mkdtempSync(join(tmpdir(), "ordarium-g16-"));
    directories.push(directory);
    const path = join(directory, "operations.sqlite");

    for (const invalid of [
      { attempts: 0 },
      { attempts: 1.5 },
      { attempts: -3 },
      { delayMs: -1 },
      { attempts: Number.NaN },
    ]) {
      expect(() => new SqliteLedger(path, { openRetry: invalid }), JSON.stringify(invalid))
        .toThrowError(TypeError);
    }
    expect(() => new SqliteLedger(path, { openRetry: "fast" as unknown as never }))
      .toThrowError(TypeError);
  });

  it("keeps the stable error family on exhausted retries (G16 surface)", async () => {
    const { path } = await createV2DatabaseWithOperation();
    spawnLockHolder(path, 2_000);
    await waitForWriteLock(path);
    let thrown: unknown;
    try {
      new SqliteLedger(path, { timeoutMs: 50, openRetry: { attempts: 2, delayMs: 10 } });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(OrdariumError);
    expect((thrown as OrdariumError).code).toBe("LEDGER_BUSY");
  });
});
