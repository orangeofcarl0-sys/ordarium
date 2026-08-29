// G12 stress worker (evidence/G12/design-spec.md §2): one process contending
// on a shared SQLite ledger. Runs a single mode for a fixed duration, then
// prints one JSON result line on stdout.
//
//   node tools/stress-worker.mjs --db <path> --mode <mode> --duration <ms> --id <i>

import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const coreRoot = join(here, "..", "packages", "core", "dist", "src", "index.js");
const sqliteRoot = join(here, "..", "packages", "ledger-sqlite", "dist", "src", "index.js");

const { digestJson } = await import(`file://${coreRoot.replaceAll("\\", "/")}`);
const { SqliteLedger } = await import(`file://${sqliteRoot.replaceAll("\\", "/")}`);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    args[argv[i].replace(/^--/, "")] = argv[i + 1];
  }
  return args;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

const args = parseArgs(process.argv.slice(2));
const dbPath = args.db;
const mode = args.mode;
const durationMs = Number(args.duration ?? 4_000);
const workerId = Number(args.id ?? 0);

// Opening a hot ledger can hit the writer lock (stable LEDGER_BUSY before any
// handle exists); a joining host retries with backoff. Recorded as a finding.
// Since G16 the constructor itself carries a default bounded backoff, so this
// G12-era wrapper only matters if that built-in retry is already exhausted.
async function openLedgerWithRetry(path, attempts = 10) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return new SqliteLedger(path);
    } catch (error) {
      if (error.code !== "LEDGER_BUSY") throw error;
      lastError = error;
      await new Promise((resolveSleep) => setTimeout(resolveSleep, 100));
    }
  }
  throw lastError;
}

// Transient writer-lock saturation inside the hot loop is honest contention,
// not a failure: counted as a conflict and retried like a CAS loss.
async function withBusyTolerance(fn) {
  try {
    return { ok: await fn() };
  } catch (error) {
    if (error.code === "LEDGER_BUSY") return { busy: true };
    throw error;
  }
}

// The open-probe calls the constructor bare: G16's built-in bounded backoff
// IS the mechanism under test, so the outer retry wrapper must not mask it.
const ledger = mode === "open-probe"
  ? new SqliteLedger(dbPath)
  : await openLedgerWithRetry(dbPath);
const identity = {
  source: "stress",
  scope: "g12",
  callId: `call-${workerId}`,
};

const result = {
  mode,
  workerId,
  attempts: 0,
  successes: 0,
  conflicts: 0,
  successLatencies: [],
};

function elapsedNs(start) {
  return Number(process.hrtime.bigint() - start);
}

function recordLatency(ns) {
  result.successLatencies.push(ns);
}

const deadline = Date.now() + durationMs;

if (mode === "open-probe") {
  // G16-A01 probe: the constructor call above IS the test - a process
  // opening the contended ledger with the default bounded backoff. No
  // stress loop runs; the shared exit below prints the probe line.
} else if (mode === "state-shared" || mode === "state-own") {
  const subjectKey = mode === "state-shared" ? "shared" : `own-${workerId}`;
  let knownRevision = 0;
  // state-own never contends; seed from the ledger so the same loop shape runs.
  const current = await ledger.getState("stress", subjectKey);
  knownRevision = current?.revision ?? 0;

  while (Date.now() < deadline) {
    result.attempts += 1;
    const start = process.hrtime.bigint();
    const value = { worker: workerId, revision: knownRevision + 1 };
    const outcome = await withBusyTolerance(() => ledger.compareAndSetState(
      "stress",
      subjectKey,
      knownRevision,
      {
        schemaVersion: 1,
        namespace: "stress",
        key: subjectKey,
        revision: knownRevision + 1,
        value,
        valueDigest: digestJson(value),
        refs: [],
        identity,
        writtenAt: new Date().toISOString(),
      },
    ));
    const ns = elapsedNs(start);
    if (outcome.busy === true) {
      result.conflicts += 1;
      const latest = await ledger.getState("stress", subjectKey);
      knownRevision = latest?.revision ?? knownRevision;
    } else if (outcome.ok) {
      knownRevision += 1;
      result.successes += 1;
      recordLatency(ns);
    } else {
      result.conflicts += 1;
      const latest = await ledger.getState("stress", subjectKey);
      knownRevision = latest?.revision ?? knownRevision;
    }
  }
} else if (mode === "ops-lifecycle") {
  let counter = 0;
  while (Date.now() < deadline) {
    counter += 1;
    result.attempts += 1;
    const start = process.hrtime.bigint();
    const operationId = `op_${createHash("sha256")
      .update(`${workerId}:${counter}:${process.pid}`)
      .digest("hex")
      .slice(0, 40)}`;
    const created = {
      schemaVersion: 2,
      operationId,
      actionName: "stress.lifecycle",
      actionVersion: "1",
      inputDigest: "a".repeat(64),
      logicalKeyDigest: "b".repeat(64),
      identity,
      effectKind: "idempotent",
      idempotencyMode: "operation-key",
      state: "proposed",
      semanticRevision: 0,
      attempts: 0,
      lastFencingToken: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const createdResult = await withBusyTolerance(() => ledger.create(created));
    if (createdResult.busy === true || !createdResult.ok.created) {
      result.conflicts += 1;
      continue;
    }
    const claimed = await withBusyTolerance(() => ledger.claim(
      operationId,
      0,
      { owner: `worker-${workerId}`, fencingToken: 1, acquiredAt: new Date().toISOString(), resumeFrom: "authorized" },
      { owner: `worker-${workerId}`, fencingToken: 1, expiresAt: new Date(Date.now() + 30_000).toISOString() },
    ));
    if (claimed.busy === true || !claimed.ok) {
      result.conflicts += 1;
      continue;
    }
    // The terminal write must carry the claimed record's fencing token - a
    // stale pre-claim base is correctly rejected by the fence check.
    const claimedRecord = await ledger.get(operationId);
    if (claimedRecord === undefined) {
      result.conflicts += 1;
      continue;
    }
    const succeeded = {
      ...claimedRecord,
      state: "succeeded",
      semanticRevision: 2,
      attempts: 1,
      claim: undefined,
      result: "ok",
      updatedAt: new Date().toISOString(),
    };
    const completed = await withBusyTolerance(() => ledger.compareAndSet(operationId, 1, succeeded));
    if (completed.busy === true || !completed.ok) {
      result.conflicts += 1;
      continue;
    }
    result.successes += 1;
    recordLatency(elapsedNs(start));
  }
} else {
  throw new Error(`unknown stress mode: ${mode}`);
}

ledger.close();

if (mode === "open-probe") {
  // Exactly one stdout line per worker; the parent parses the last line.
  process.stdout.write(`${JSON.stringify({ mode, workerId, opened: true })}\n`);
} else {
  result.p50 = percentile(result.successLatencies.sort((a, b) => a - b), 50) / 1e6;
  result.p95 = percentile(result.successLatencies.sort((a, b) => a - b), 95) / 1e6;
  result.p99 = percentile(result.successLatencies.sort((a, b) => a - b), 99) / 1e6;
  result.max = (result.successLatencies.at(-1) ?? 0) / 1e6;
  delete result.successLatencies;
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
