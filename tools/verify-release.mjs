// Release gate aggregation (G7 design spec §3): runs every release-blocking
// verification in order and prints the evidence summary. Add --with-matrix
// to include the Docker Node matrix (requires Docker; see
// evidence/G7/node-matrix-report.md for the recorded run).

import { spawnSync } from "node:child_process";

const gates = [
  ["check", ["pnpm", "run", "check"]],
  ["architecture", ["pnpm", "run", "verify:architecture"]],
  ["integration", ["pnpm", "run", "test:integration"]],
  ["conformance", ["pnpm", "run", "test:conformance"]],
  ["docs", ["pnpm", "run", "verify:docs"]],
  ["package", ["pnpm", "run", "test:package"]],
];
if (process.argv.includes("--with-matrix")) {
  gates.push(["node-matrix", ["pnpm", "run", "verify:matrix"]]);
}

const results = [];
for (const [name, [command, ...args]] of gates) {
  process.stdout.write(`\n=== release gate: ${name} ===\n`);
  const result = spawnSync(command, args, { stdio: "inherit", shell: true });
  results.push([name, result.status === 0]);
}

process.stdout.write("\n=== release evidence summary ===\n");
let failed = 0;
for (const [name, ok] of results) {
  process.stdout.write(`  ${ok ? "PASS" : "FAIL"}  ${name}\n`);
  if (!ok) failed += 1;
}
if (failed > 0) {
  process.stderr.write(`verify:release FAILED (${failed} gate(s))\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("verify:release passed\n");
}
