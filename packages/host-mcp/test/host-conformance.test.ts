import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { OrdariumRuntime } from "@ordarium/core";
import { SqliteLedger } from "@ordarium/ledger-sqlite";
import { runHostAdapterConformance } from "@ordarium/testing";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    // Windows releases child-held SQLite handles asynchronously; retry.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        rmSync(directory, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }
});

/**
 * G18-A04: the real MCP adapter runtime drives the portable host-contract
 * kit end to end on a scratch ledger — the same run an external first host
 * (Palimpsest) performs on its side.
 */
describe("host adapter conformance against the MCP adapter runtime", () => {
  it("passes the full kit on a durable scratch ledger", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ordarium-mcp-g18-"));
    directories.push(directory);
    const ledger = new SqliteLedger(join(directory, "operations.sqlite"));
    const runtime = new OrdariumRuntime({
      ledger,
      deploymentCoordination: "local-multi-process",
    });
    await expect(runHostAdapterConformance(runtime, runtime.ledger)).resolves.toBeUndefined();
  });
});
