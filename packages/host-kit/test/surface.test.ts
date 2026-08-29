import { OrdariumRuntime, assertHostContract as coreAssert } from "@ordarium/core";
import { describe, expect, it } from "vitest";

import * as hostKit from "../src/index.js";
import { HOST_CONTRACT_VERSION, assertHostContract, runHostAdapterConformance } from "../src/index.js";

describe("host-kit curated surface", () => {
  it("exports exactly the frozen adapter surface (G18 §1)", () => {
    expect(Object.keys(hostKit).sort()).toEqual([
      "HOST_CONTRACT_VERSION",
      "HostAdapterHarness",
      "HostContractMismatchError",
      "OrdariumError",
      "assertHostContract",
      "runHostAdapterConformance",
    ]);
  });

  it("re-exports the single contract truth and drives the conformance runner", async () => {
    expect(() => assertHostContract(HOST_CONTRACT_VERSION)).not.toThrow();
    expect(coreAssert).toBe(assertHostContract);
    const runtime = new OrdariumRuntime({ allowVolatileLedger: true });
    await expect(runHostAdapterConformance(runtime, runtime.ledger)).resolves.toBeUndefined();
  });
});
