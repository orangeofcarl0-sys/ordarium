import { OrdariumRuntime, type HostInvocationPort } from "@ordarium/core";
import { describe, expect, it } from "vitest";

import { runHostAdapterConformance } from "../src/index.js";

describe("runHostAdapterConformance", () => {
  it("passes all scenarios against a conformant runtime and ledger", async () => {
    const runtime = new OrdariumRuntime({ allowVolatileLedger: true });
    await expect(runHostAdapterConformance(runtime, runtime.ledger)).resolves.toBeUndefined();
  });

  it("skips record-level assertions when the host exposes no ledger view", async () => {
    const runtime = new OrdariumRuntime({ allowVolatileLedger: true });
    await expect(runHostAdapterConformance(runtime)).resolves.toBeUndefined();
  });

  it("detects an adapter that breaks replay convergence", async () => {
    const runtime = new OrdariumRuntime({ allowVolatileLedger: true });
    let scrambledCalls = 0;
    const scrambled: HostInvocationPort = {
      async invoke(action, input, invocation) {
        scrambledCalls += 1;
        return runtime.invoke(action, input, {
          ...invocation,
          identity: { ...invocation.identity, callId: `scrambled-${scrambledCalls}` },
        });
      },
    };
    await expect(runHostAdapterConformance(scrambled)).rejects.toThrow(
      /host adapter conformance violation: replay/,
    );
  });
});
