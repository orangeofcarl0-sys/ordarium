import { OrdariumRuntime, defineAction, defineSchema, effects } from "@ordarium/core";
import { describe, expect, it } from "vitest";

import { FaultInjector, ManualClock, fixedIdentity } from "../src/index.js";

describe("testing helpers", () => {
  it("crashes at a deterministic durable checkpoint", async () => {
    const schema = defineSchema<string>({ type: "string" }, (value) => {
      if (typeof value !== "string") throw new TypeError("expected string");
      return value;
    });
    const action = defineAction({
      name: "testing.crash",
      version: "1",
      description: "Crash after dispatch",
      input: schema,
      output: schema,
      effect: effects.readOnly(),
      execute: (input) => input,
    });
    const clock = new ManualClock();
    const runtime = new OrdariumRuntime({
      clock: clock.now,
      hooks: new FaultInjector().crashAt("after-dispatch"),
    });

    await expect(action.run(runtime, "value", { identity: fixedIdentity() }))
      .rejects.toMatchObject({ code: "SIMULATED_PROCESS_CRASH" });
    const [record] = (await runtime.ledger.list()).records;
    expect(record?.state).toBe("dispatched");
  });
});
