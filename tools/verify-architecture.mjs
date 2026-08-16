// G0 architecture freeze verification (docs/17 §8, §18.3).
//
//   node tools/verify-architecture.mjs           verify; any unexplained drift fails
//   node tools/verify-architecture.mjs --update  regenerate snapshots; only allowed with an
//                                                Architecture Delta Sheet in evidence/
//
// Checks:
//   1. package set, dependency graph, forbidden edges, cycles, undeclared imports
//   2. public API surface snapshot (built .d.ts per package) and export maps
//   3. frozen unions (error codes, states, guarantees, checkpoints)
//   4. SQLite ledger baseline: PRAGMAs, schema, deterministic record fixture, reopen
//   5. compatibility register completeness

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOTS = join(ROOT, "snapshots");
const UPDATE = process.argv.includes("--update");

const expectedPackages = {
  "@ordarium/core": { workspaceDeps: [], externalDeps: [] },
  "@ordarium/ledger-sqlite": { workspaceDeps: ["@ordarium/core"], externalDeps: [] },
  "@ordarium/dsh": {
    workspaceDeps: ["@ordarium/core", "@ordarium/ledger-sqlite"],
    externalDeps: [],
  },
  "@ordarium/testing": { workspaceDeps: ["@ordarium/core"], externalDeps: [] },
};

const failures = [];
const notes = [];
function fail(message) {
  failures.push(message);
}

function listFiles(directory, matcher, acc = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) listFiles(full, matcher, acc);
    else if (matcher.test(entry.name)) acc.push(full);
  }
  return acc;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readPragma(database, name) {
  const row = database.prepare(`PRAGMA ${name}`).get();
  return row?.[name];
}

function compareSnapshot(relativePath, currentText) {
  const absolute = join(SNAPSHOTS, relativePath);
  if (UPDATE) {
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, currentText, "utf8");
    notes.push(`snapshot updated: snapshots/${relativePath.split("\\").pop()}`);
    return;
  }
  if (!existsSync(absolute)) {
    fail(`snapshot missing: snapshots/${relativePath} (run with --update after a Delta Sheet)`);
    return;
  }
  const stored = readFileSync(absolute, "utf8");
  if (stored === currentText) return;
  const storedLines = stored.split("\n");
  const currentLines = currentText.split("\n");
  let index = 0;
  while (index < storedLines.length && storedLines[index] === currentLines[index]) index += 1;
  fail(
    `snapshot drift: snapshots/${relativePath} first differs at line ${index + 1}\n` +
      `  stored : ${storedLines[index] ?? "<eof>"}\n` +
      `  current: ${currentLines[index] ?? "<eof>"}`,
  );
}

function compareJsonSnapshot(relativePath, value) {
  compareSnapshot(relativePath, stableJson(value));
}

// ---------------------------------------------------------------------------
// 0. Build first so .d.ts and dist JS reflect the current source tree.
// ---------------------------------------------------------------------------

const build = spawnSync("pnpm run build", { cwd: ROOT, shell: true, stdio: "pipe", encoding: "utf8" });
if (build.status !== 0) {
  process.stdout.write(build.stdout ?? "");
  process.stderr.write(build.stderr ?? "");
  fail("pnpm run build failed; architecture verification requires a green build");
}

// ---------------------------------------------------------------------------
// 1. Package graph, declared vs actual imports, forbidden edges, cycles.
// ---------------------------------------------------------------------------

const packageDirs = readdirSync(join(ROOT, "packages"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(ROOT, "packages", entry.name));
const discovered = {};
for (const directory of packageDirs) {
  const manifest = readJson(join(directory, "package.json"));
  discovered[manifest.name] = directory;
}
for (const name of Object.keys(expectedPackages)) {
  if (discovered[name] === undefined) fail(`expected package is missing: ${name}`);
}
for (const name of Object.keys(discovered)) {
  if (expectedPackages[name] === undefined) fail(`unexpected package outside the frozen set: ${name}`);
}

const fromClause = /\bfrom\s+["']([^"']+)["']/g;
function scanImports(directory) {
  const found = { workspace: new Set(), external: new Set(), node: new Set(), relative: new Set() };
  for (const file of listFiles(join(directory, "src"), /\.ts$/u)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(fromClause)) {
      const specifier = match[1];
      if (specifier.startsWith(".")) found.relative.add(specifier);
      else if (specifier.startsWith("node:")) found.node.add(specifier);
      else if (specifier.startsWith("@ordarium/")) found.workspace.add(specifier);
      else found.external.add(specifier);
    }
  }
  return found;
}

const graph = {};
const importScan = {};
for (const [name, directory] of Object.entries(discovered)) {
  const manifest = readJson(join(directory, "package.json"));
  const declared = Object.keys(manifest.dependencies ?? {});
  const imported = scanImports(directory);
  importScan[name] = {
    workspace: [...imported.workspace].sort(),
    external: [...imported.external].sort(),
    nodeBuiltins: [...imported.node].sort(),
    relativeImportCount: imported.relative.size,
  };
  graph[name] = {
    version: manifest.version,
    workspaceDependencies: declared.filter((dep) => dep.startsWith("@ordarium/")).sort(),
    externalDependencies: declared.filter((dep) => !dep.startsWith("@ordarium/")).sort(),
    exports: manifest.exports,
    private: manifest.private === true,
  };

  const rule = expectedPackages[name] ?? { workspaceDeps: null, externalDeps: null };
  if (rule.workspaceDeps !== null) {
    for (const dep of graph[name].workspaceDependencies) {
      if (!rule.workspaceDeps.includes(dep)) {
        fail(`${name} declares workspace dependency outside the frozen allowlist: ${dep}`);
      }
    }
    for (const dep of importScan[name].workspace) {
      if (!graph[name].workspaceDependencies.includes(dep)) {
        fail(`${name} imports ${dep} without declaring it in package.json`);
      }
    }
  }
  if (rule.externalDeps !== null) {
    if (graph[name].externalDependencies.length > 0) {
      fail(`${name} declares external runtime dependencies: ${graph[name].externalDependencies.join(", ")}`);
    }
    if (importScan[name].external.length > 0) {
      fail(`${name} imports external modules from src/: ${importScan[name].external.join(", ")}`);
    }
  }
}

const visiting = new Set();
const done = new Set();
function detectCycle(node, trail) {
  if (done.has(node)) return;
  if (visiting.has(node)) {
    fail(`workspace dependency cycle: ${[...trail, node].join(" -> ")}`);
    return;
  }
  visiting.add(node);
  for (const dep of graph[node]?.workspaceDependencies ?? []) detectCycle(dep, [...trail, node]);
  visiting.delete(node);
  done.add(node);
}
for (const name of Object.keys(graph)) detectCycle(name, []);

// ---------------------------------------------------------------------------
// 2. Public API snapshots: every built declaration file (not just index.d.ts,
//    because `export *` hides the real surface behind re-exports) + frozen unions.
// ---------------------------------------------------------------------------

for (const [name, directory] of Object.entries(discovered)) {
  const pkg = name.slice("@ordarium/".length);
  const distSrc = join(directory, "dist", "src");
  if (!existsSync(distSrc)) {
    fail(`built output is missing for ${name}: ${distSrc}`);
    continue;
  }
  const declarations = listFiles(distSrc, /\.d\.ts$/u).sort();
  if (declarations.length === 0) {
    fail(`no declaration files were emitted for ${name}`);
    continue;
  }
  for (const file of declarations) {
    const relativePath = relative(distSrc, file).split(sep).join("/");
    compareSnapshot(`api/${pkg}/${relativePath}`, readFileSync(file, "utf8"));
  }
}

// Curated dsh root façade (G1-A08 / COMPAT-API-002): the root entry may only
// re-export the author golden path; everything else lives in /advanced.
{
  const dshExports = graph["@ordarium/dsh"]?.exports ?? {};
  if (!("." in dshExports) || !("./advanced" in dshExports)) {
    fail("@ordarium/dsh must expose exactly the curated root and /advanced subpath exports");
  }
  const rootSource = readFileSync(join(discovered["@ordarium/dsh"], "src", "index.ts"), "utf8");
  const rootSymbols = new Set();
  for (const match of rootSource.matchAll(/export\s+(?:type\s+)?\{([^}]+)\}\s*from/gu)) {
    for (const name of match[1].split(",")) {
      const trimmed = name.trim();
      if (trimmed.length > 0) rootSymbols.add(trimmed);
    }
  }
  const allowedRootSymbols = new Set([
    "defineAction",
    "defineSchema",
    "effects",
    "installOrdarium",
    "jsonValueSchema",
    "schema",
    "Action",
    "ActionDefinition",
    "ActionExecutionContext",
    "ActionSchema",
    "AuthorizationDecision",
    "CreateDshOrdariumOptions",
    "DshOrdarium",
    "EffectProfile",
    "InstallOrdariumOptions",
    "InvocationIdentity",
    "JsonObject",
    "JsonValue",
    "ReconcileResult",
  ]);
  for (const name of rootSymbols) {
    if (!allowedRootSymbols.has(name)) {
      fail(
        `@ordarium/dsh root façade exports non-curated symbol: ${name} ` +
          "(move it to /advanced or extend the allowlist via a Delta Sheet)",
      );
    }
  }
  notes.push(`dsh root façade: ${rootSymbols.size} curated exports verified`);
}

function extractUnion(file, typeName) {
  const text = readFileSync(file, "utf8");
  const start = text.indexOf(`export type ${typeName} =`);
  if (start === -1) fail(`union ${typeName} not found in ${file}`);
  const end = text.indexOf(";", start);
  return [...text.slice(start, end).matchAll(/"([^"]+)"/gu)].map((match) => match[1]);
}

const coreSrc = join(discovered["@ordarium/core"], "src");
const errorCodes = new Set();
for (const file of listFiles(coreSrc, /\.ts$/u)) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/\b(?:super\(\s*|code:\s*)"([A-Z][A-Z0-9_]{3,})"/gu)) {
    errorCodes.add(match[1]);
  }
}

const contracts = {
  goalRevision: "ORDARIUM-GOALS-3",
  frozenAt: "G0",
  packages: graph,
  importScan,
  errorCodes: [...errorCodes].sort(),
  operationStates: extractUnion(join(coreSrc, "types.ts"), "OperationState"),
  guaranteeLevels: extractUnion(join(coreSrc, "effects.ts"), "GuaranteeLevel"),
  runtimeCheckpoints: extractUnion(join(coreSrc, "runtime.ts"), "RuntimeCheckpoint"),
};
compareJsonSnapshot("contracts.json", contracts);

// ---------------------------------------------------------------------------
// 3. SQLite ledger baseline: deterministic database dump + reopen proof.
// ---------------------------------------------------------------------------

const ledgerEntry = join(discovered["@ordarium/ledger-sqlite"], "dist", "src", "index.js");
const { SqliteLedger } = await import(pathToFileURL(ledgerEntry).href);

const created = {
  schemaVersion: 1,
  operationId: `op_${"0123456789abcdef".repeat(3).slice(0, 40)}`,
  actionName: "fixture.baseline",
  actionVersion: "1",
  inputDigest: "a".repeat(64),
  logicalKeyDigest: "b".repeat(64),
  identity: { source: "dsh", scope: "fixture", callId: "call-fixture", rootCallId: "call-root" },
  guarantee: "idempotent",
  state: "proposed",
  revision: 0,
  attempts: 0,
  lastFencingToken: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const authorized = {
  ...created,
  state: "authorized",
  revision: 1,
  authorization: { decision: "allow", kind: "host-admission", source: "fixture:admission", at: "2026-01-01T00:00:01.000Z" },
  providerPrincipalDigest: "c".repeat(64),
  contractFingerprint: "d".repeat(64),
  updatedAt: "2026-01-01T00:00:01.000Z",
};

const workdir = join(tmpdir(), `ordarium-g0-${process.pid}`);
rmSync(workdir, { recursive: true, force: true });
mkdirSync(workdir, { recursive: true });
const databasePath = join(workdir, "operations.sqlite");
try {
  const ledger = new SqliteLedger(databasePath);
  const createResult = await ledger.create(created);
  if (!createResult.created) fail("ledger baseline: create() reported an existing operation");
  const casResult = await ledger.compareAndSet(created.operationId, 0, authorized);
  if (!casResult) fail("ledger baseline: compareAndSet() lost a revision-0 uncontended update");
  ledger.close();

  const reopened = new SqliteLedger(databasePath);
  const stored = await reopened.get(created.operationId);
  if (JSON.stringify(stored) !== JSON.stringify(authorized)) {
    fail("ledger baseline: reopened record does not round-trip the authorized fixture");
  }
  const events = await reopened.history(created.operationId);
  if (events.length !== 2 || events[0].revision !== 0 || events[1].revision !== 1) {
    fail("ledger baseline: reopened history does not contain both revisions");
  }
  reopened.close();

  const raw = new DatabaseSync(databasePath);
  const baseline = {
    schemaVersion: 1,
    pragmas: {
      application_id: readPragma(raw, "application_id"),
      user_version: readPragma(raw, "user_version"),
      journal_mode: readPragma(raw, "journal_mode"),
    },
    schema: raw
      .prepare(
        "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
      )
      .all(),
    operations: raw
      .prepare(
        "SELECT operation_id, revision, state, updated_at, record_json FROM ordarium_operations ORDER BY operation_id",
      )
      .all(),
    events: raw
      .prepare(
        "SELECT operation_id, revision, state, at, record_json FROM ordarium_operation_events ORDER BY operation_id, revision",
      )
      .all(),
  };
  raw.close();
  if (baseline.pragmas.application_id !== 0x4f524441) {
    fail(`ledger baseline: application_id is not ORDA (${baseline.pragmas.application_id})`);
  }
  if (baseline.pragmas.user_version !== 1) {
    fail(`ledger baseline: user_version is not 1 (${baseline.pragmas.user_version})`);
  }
  compareJsonSnapshot("sqlite-v1.json", baseline);
} finally {
  rmSync(workdir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 4. Compatibility register completeness (docs/17 §6, G0-A07).
// ---------------------------------------------------------------------------

const registerFile = join(ROOT, "evidence", "compatibility-register.md");
if (!existsSync(registerFile)) {
  fail("compatibility register is missing: evidence/compatibility-register.md");
} else {
  const rows = readFileSync(registerFile, "utf8")
    .split("\n")
    .filter((line) => line.startsWith("| `COMPAT-"));
  if (rows.length === 0) fail("compatibility register has no registered entries");
  const seen = new Set();
  for (const row of rows) {
    const cells = row.split("|").map((cell) => cell.trim());
    cells.shift();
    cells.pop();
    const [id, boundary, source, target, owner, removal] = cells;
    if (id === undefined || !/^`?COMPAT-[A-Z]+-\d+`?$/.test(id)) {
      fail(`compatibility register row has an invalid ID: ${row}`);
      continue;
    }
    if (seen.has(id)) fail(`compatibility register duplicates ${id}`);
    seen.add(id);
    for (const [label, value] of [
      ["boundary", boundary],
      ["compat source", source],
      ["canonical target", target],
      ["owner", owner],
      ["removal decision", removal],
    ]) {
      if (value === undefined || value.length === 0) {
        fail(`compatibility register entry ${id} has an empty ${label} column (anonymous layers are forbidden)`);
      }
    }
  }
  notes.push(`compatibility register: ${rows.length} entries verified`);
}

// ---------------------------------------------------------------------------
// 5. Summary.
// ---------------------------------------------------------------------------

if (failures.length > 0) {
  process.stderr.write(`verify:architecture FAILED (${failures.length}):\n`);
  for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
  process.stderr.write(
    "\nDrift must be explained by an Architecture Delta Sheet (evidence/README.md) before running --update.\n",
  );
  process.exitCode = 1;
} else {
  process.stdout.write("verify:architecture passed\n");
  for (const note of notes) process.stdout.write(`  - ${note}\n`);
  if (UPDATE) process.stdout.write("  - snapshots regenerated; commit them together with the Delta Sheet\n");
}
