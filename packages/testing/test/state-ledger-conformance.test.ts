import { MemoryLedger } from "@ordarium/core";
import { describe, expect, it } from "vitest";

import { runStateLedgerConformance } from "../src/index.js";

describe("state ledger conformance (G11-A09)", () => {
  it("MemoryLedger reproduces the state-kind contract on the shared machinery", async () => {
    const ledger = new MemoryLedger();
    await expect(runStateLedgerConformance(ledger)).resolves.toBeUndefined();
  });
});
