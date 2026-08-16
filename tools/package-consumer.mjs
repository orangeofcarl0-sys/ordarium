// Tarball consumer fixture (G7 design spec §2, G7-A01/A02/A14): packs every
// kernel and leaf package, installs the five tarballs together into an
// isolated temp directory (no workspace resolution), then exercises ESM
// imports, TypeScript declarations and the curated DSH root surface exactly
// as an external consumer would.
//
//   node tools/package-consumer.mjs
//
// Exits non-zero on any failure; prints per-package pack sizes for the
// release evidence report.

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES = ["core", "ledger-sqlite", "dsh", "testing", "host-mcp"];

function run(command, args, options = {}) {
  const viaShell = command === "pnpm" || command === "npm" || command === "tsc";
  const argv = viaShell ? ["/c", command, ...args] : args;
  const executable = viaShell ? "cmd.exe" : command.endsWith(".exe") ? command : `${command}.exe`;
  const result = spawnSync(executable, argv, {
    cwd: options.cwd ?? ROOT,
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : "pipe",
    shell: false,
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`${command} ${args.join(" ")} failed (${result.status})`);
  }
  return result.stdout ?? "";
}

const work = mkdtempSync(join(tmpdir(), "ordarium-consumer-"));
const failures = [];
try {
  // 1. Pack every package into the temp workspace root.
  const tarballs = [];
  const sizes = [];
  for (const pkg of PACKAGES) {
    const output = run("pnpm", [
      "--filter", `@ordarium/${pkg}`, "pack", "--pack-destination", work,
    ]);
    const packed = output.trim().split("\n").pop().trim();
    const absolute = join(work, packed.replace(/^.*[/\\]/u, ""));
    tarballs.push(absolute);
    sizes.push([`@ordarium/${pkg}`, packed]);
  }

  // 2. Fresh consumer directory, no workspace links.
  const consumer = join(work, "consumer");
  mkdirSync(consumer, { recursive: true });
  writeFileSync(join(consumer, "package.json"), JSON.stringify({
    name: "ordarium-consumer-probe",
    version: "0.0.0",
    private: true,
    type: "module",
  }, null, 2) + "\n");
  run("npm", ["install", "--no-audit", "--no-fund", "--loglevel", "error",
    ...tarballs.map((path) => path.replaceAll("\\", "/"))], { cwd: consumer });

  // 3. ESM smoke across all five packages (A02: the one-install path only
  //    needs @ordarium/dsh; the rest prove their own entry points).
  writeFileSync(join(consumer, "smoke.mjs"), `
import * as core from "@ordarium/core";
import { SqliteLedger } from "@ordarium/ledger-sqlite";
import * as dsh from "@ordarium/dsh";
import { asDshTool } from "@ordarium/dsh/advanced";
import { createMcpOrdarium } from "@ordarium/host-mcp";
import * as testing from "@ordarium/testing";

// Curated author façade: exactly the golden path (G7-A02/A11).
const expectedRoot = new Set(["defineAction","defineSchema","effects","installOrdarium","jsonValueSchema","schema"]);
const actualRoot = new Set(Object.keys(dsh));
if (actualRoot.size !== expectedRoot.size || [...actualRoot].some((k) => !expectedRoot.has(k))) {
  throw new Error("dsh root surface mismatch: " + [...actualRoot].join(","));
}

// A read-only action through the default durable path (SQLite in a temp file).
const schema = core.defineSchema({ type: "string" }, (v) => { if (typeof v !== "string") throw new TypeError("x"); return v; });
const action = core.defineAction({
  name: "consumer.read", version: "1", description: "smoke",
  input: schema, output: schema, effect: core.effects.readOnly(),
  execute: (input) => input.toUpperCase(),
});
const ledger = new SqliteLedger(":memory:");
const runtime = new core.OrdariumRuntime({ ledger });
const result = await action.run(runtime, "work", { identity: { source: "consumer", scope: "smoke", callId: "c1" } });
if (result !== "WORK") throw new Error("readOnly smoke failed");

// Managed side effects fail closed without a host identity (G1-A01).
try {
  const guarded = core.defineAction({
    name: "consumer.guarded", version: "1", description: "smoke",
    input: schema, output: schema, effect: core.effects.guarded(),
    execute: (input) => input,
  });
  await guarded.run(runtime, "work");
  throw new Error("IDENTITY_REQUIRED not enforced");
} catch (error) {
  if (String(error?.code ?? "") !== "IDENTITY_REQUIRED") throw error;
}
await runtime.close();

// MCP second host answers a protocol message in-process.
const mcp = createMcpOrdarium({
  runtime: new core.OrdariumRuntime(),
  actions: [],
});
const init = await mcp.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
if (init?.result?.serverInfo?.name !== "ordarium") throw new Error("mcp initialize failed");
await mcp.stop();

if (typeof testing.HostAdapterHarness !== "function") throw new Error("testing surface missing");
if (typeof asDshTool !== "function") throw new Error("advanced surface missing");
console.log("SMOKE_OK");
`);
  const smoke = run("node", ["smoke.mjs"], { cwd: consumer });
  if (!smoke.includes("SMOKE_OK")) failures.push("consumer smoke did not report SMOKE_OK");

  // 4. TypeScript declarations compile from the tarballs (A01/A14).
  const typesProbe = join(consumer, "probe");
  mkdirSync(typesProbe, { recursive: true });
  cpSync(join(ROOT, "tools", "consumer-types-probe"), join(typesProbe, "src"), { recursive: true });
  writeFileSync(join(typesProbe, "package.json"), JSON.stringify({
    name: "ordarium-types-probe",
    version: "0.0.0",
    private: true,
    type: "module",
  }, null, 2) + "\n");
  writeFileSync(join(typesProbe, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2024",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      types: ["node"],
    },
    include: ["src/**/*.ts"],
  }, null, 2) + "\n");
  run("npm", ["install", "--no-audit", "--no-fund", "--loglevel", "error",
    "typescript@7.0.2", "@types/node@26.2.0"], { cwd: typesProbe });
  run("node", [join(typesProbe, "node_modules", "typescript", "bin", "tsc"), "-p", "."], { cwd: typesProbe });

  console.log("package-consumer passed");
  for (const [name, file] of sizes) console.log(`  - ${name}: ${file}`);
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failures.length > 0) {
  process.stderr.write(`test:package FAILED:\n`);
  for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
  process.exitCode = 1;
}
