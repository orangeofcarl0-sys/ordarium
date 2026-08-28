// G12 stress matrix parent (evidence/G12/design-spec.md §2): spawns K worker
// processes concurrently against one shared SQLite ledger per leg, aggregates
// throughput, conflict rates and latency percentiles, and verifies the
// no-lost-update invariants before printing a markdown table and writing
// evidence/G12/stress-results.json.
//
//   node tools/stress-matrix.mjs [--duration 4000]

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HERE = dirname(fileURLToPath(import.meta.url));
const DURATION = Number(process.argv.includes("--duration")
  ? process.argv[process.argv.indexOf("--duration") + 1]
  : 4_000);
const PROCESSES = [1, 2, 4, 8];
const MODES = ["state-shared", "state-own", "ops-lifecycle"];

const { SqliteLedger } = await import(
  pathToFileURL(join(ROOT, "packages", "ledger-sqlite", "dist", "src", "index.js")).href
);
const { decodeOperationRecord } = await import(
  pathToFileURL(join(ROOT, "packages", "core", "dist", "src", "index.js")).href
);

function runWorker(workerId, mode, dbPath) {
  return new Promise((resolveWorker, rejectWorker) => {
    const child = spawn(
      process.execPath,
      [
        join(HERE, "stress-worker.mjs"),
        "--db", dbPath,
        "--mode", mode,
        "--duration", String(DURATION),
        "--id", String(workerId),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill();
      rejectWorker(new Error(`worker ${workerId} timed out`));
    }, DURATION + 60_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      rejectWorker(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        rejectWorker(new Error(`worker ${workerId} failed (${code}): ${stderr.slice(0, 400)}`));
        return;
      }
      resolveWorker(JSON.parse(stdout.trim().split("\n").at(-1)));
    });
  });
}

async function runLeg(processes, mode) {
  const workdir = mkdtempSync(join(tmpdir(), "ordarium-g12-"));
  const dbPath = join(workdir, "operations.sqlite");
  const workers = await Promise.all(
    Array.from({ length: processes }, (_, id) => runWorker(id, mode, dbPath)),
  );
  return { workers, workdir, dbPath };
}

async function verifyInvariants(mode, leg) {
  const { workers, dbPath } = leg;
  const ledger = new SqliteLedger(dbPath);
  const checks = [];
  try {
    if (mode === "state-shared") {
      const total = workers.reduce((sum, worker) => sum + worker.successes, 0);
      const final = await ledger.getState("stress", "shared");
      checks.push({
        id: "no-lost-update",
        pass: final?.revision === total,
        detail: `final revision ${final?.revision} == summed successes ${total}`,
      });
    } else if (mode === "state-own") {
      for (const worker of workers) {
        const final = await ledger.getState("stress", `own-${worker.workerId}`);
        checks.push({
          id: `own-${worker.workerId}-consistent`,
          pass: final?.revision === worker.successes,
          detail: `revision ${final?.revision} == successes ${worker.successes}`,
        });
      }
    } else {
      const total = workers.reduce((sum, worker) => sum + worker.successes, 0);
      const page = await ledger.list({ state: "succeeded", limit: 10_000 });
      checks.push({
        id: "lifecycle-closed",
        pass: page.records.length === total,
        detail: `succeeded records ${page.records.length} == summed successes ${total}`,
      });
      const sample = page.records[0];
      if (sample !== undefined) {
        decodeOperationRecord(structuredClone(sample));
        checks.push({ id: "sample-decodes", pass: true, detail: sample.operationId });
      }
    }
  } finally {
    ledger.close();
  }
  const failed = checks.filter((check) => !check.pass);
  if (failed.length > 0) {
    throw new Error(`invariant violation in ${mode}: ${JSON.stringify(failed)}`);
  }
  return checks;
}

const results = [];
for (const mode of MODES) {
  for (const processes of PROCESSES) {
    const leg = await runLeg(processes, mode);
    let checks;
    try {
      checks = await verifyInvariants(mode, leg);
    } finally {
      rmSync(leg.workdir, { recursive: true, force: true });
    }
    const attempts = leg.workers.reduce((sum, worker) => sum + worker.attempts, 0);
    const successes = leg.workers.reduce((sum, worker) => sum + worker.successes, 0);
    const conflicts = leg.workers.reduce((sum, worker) => sum + worker.conflicts, 0);
    const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
    results.push({
      mode,
      processes,
      durationMs: DURATION,
      attempts,
      successes,
      conflicts,
      throughputPerSec: Number((successes / (DURATION / 1000)).toFixed(1)),
      conflictRatePct: Number(((conflicts / Math.max(1, attempts)) * 100).toFixed(2)),
      p50Ms: Number(median(leg.workers.map((worker) => worker.p50)).toFixed(3)),
      p95Ms: Number(median(leg.workers.map((worker) => worker.p95)).toFixed(3)),
      p99Ms: Number(median(leg.workers.map((worker) => worker.p99)).toFixed(3)),
      maxMs: Number(Math.max(...leg.workers.map((worker) => worker.max)).toFixed(3)),
      invariantChecks: checks,
    });
    process.stdout.write(`leg done: ${mode} K=${processes} -> ${successes} successes, ${conflicts} conflicts\n`);
  }
}

const report = {
  environment: {
    platform: `${process.platform} ${process.arch}`,
    node: process.version,
    cpus: os.cpus().length,
  },
  durationMsPerLeg: DURATION,
  legs: results,
};
writeFileSync(
  join(ROOT, "evidence", "G12", "stress-results.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);

process.stdout.write("\n| mode | K | throughput/s | conflict % | p50 ms | p95 ms | p99 ms | max ms |\n");
process.stdout.write("|---|---|---|---|---|---|---|---|\n");
for (const leg of results) {
  process.stdout.write(
    `| ${leg.mode} | ${leg.processes} | ${leg.throughputPerSec} | ${leg.conflictRatePct} | ` +
    `${leg.p50Ms} | ${leg.p95Ms} | ${leg.p99Ms} | ${leg.maxMs} |\n`,
  );
}
process.stdout.write("\nstress matrix complete; all invariants passed\n");
