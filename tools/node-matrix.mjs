// Node support matrix runner (G2-A10 / G7 §4): runs the full gate inside
// Docker containers on the declared Node lines. Source is copied into the
// container (host node_modules excluded) so platform-specific binaries on
// the host are never mutated.
//
//   node tools/node-matrix.mjs [image ...]
//   defaults: node:24.15.0-slim (floor) node:24-bookworm (current 24.x)
//
// A leg passes when install, build, the full Vitest suite and
// verify:architecture all succeed; the runner exits non-zero otherwise.

import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const images = process.argv.length > 2
  ? process.argv.slice(2)
  : ["node:24.15.0-slim", "node:24-bookworm"];

const inner = [
  "set -e",
  "export COREPACK_ENABLE_DOWNLOAD_PROMPT=0",
  "corepack enable",
  "echo \"node=$(node --version) pnpm=$(pnpm --version)\"",
  "mkdir -p /work",
  "tar -C /src --exclude=./node_modules --exclude='./packages/*/node_modules' --exclude='./packages/*/dist' -cf - . | tar -C /work -xf -",
  "cd /work",
  "pnpm install --frozen-lockfile",
  "pnpm run build",
  "pnpm exec vitest run 2>&1 | tail -6",
  "node tools/verify-architecture.mjs",
  "echo MATRIX_LEG_OK",
].join("\n");

let failed = 0;
for (const image of images) {
  console.log(`\n=== matrix leg: ${image} ===`);
  const result = spawnSync(
    "docker.exe",
    [
      "run", "--rm",
      "-e", "COREPACK_ENABLE_DOWNLOAD_PROMPT=0",
      "-v", `${ROOT.replace(/\\/gu, "/")}:/src:ro`,
      image,
      "bash", "-c", inner,
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    failed += 1;
    console.error(`matrix leg FAILED: ${image}`);
  }
}
process.exitCode = failed === 0 ? 0 : 1;
