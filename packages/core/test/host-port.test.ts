import { describe, expect, it } from "vitest";

import {
  IdentityRequiredError,
  MemoryLedger,
  OrdariumRuntime,
  defineAction,
  defineSchema,
  effects,
  type HostInvocation,
  type HostInvocationPort,
} from "../src/index.js";

const text = defineSchema<string>({ type: "string" }, (value) => {
  if (typeof value !== "string") throw new TypeError("expected string");
  return value;
});

describe("HostInvocationPort", () => {
  it("fails closed with IDENTITY_REQUIRED for managed side effects without host identity", async () => {
    let executions = 0;
    const action = defineAction({
      name: "host.guarded",
      version: "1",
      description: "Guarded side effect",
      input: text,
      output: text,
      effect: effects.guarded(),
      execute: (input) => {
        executions += 1;
        return `done:${input}`;
      },
    });
    const ledger = new MemoryLedger();
    const runtime = new OrdariumRuntime({ ledger, allowVolatileLedger: true });

    await expect(action.run(runtime, "work")).rejects.toBeInstanceOf(IdentityRequiredError);
    await expect(action.run(runtime, "work")).rejects.toMatchObject({ code: "IDENTITY_REQUIRED" });
    expect(executions).toBe(0);
    expect((await ledger.list()).records).toHaveLength(0);
  });

  it("still allows random direct identity for read-only and explicit unmanaged actions", async () => {
    const readOnly = defineAction({
      name: "host.read",
      version: "1",
      description: "Read",
      input: text,
      output: text,
      effect: effects.readOnly(),
      execute: (input) => input,
    });
    const unmanaged = defineAction({
      name: "host.raw",
      version: "1",
      description: "Explicitly unmanaged",
      input: text,
      output: text,
      effect: effects.unmanaged(),
      execute: (input) => input,
    });
    const runtime = new OrdariumRuntime({ allowVolatileLedger: true });

    await expect(runtime.run(readOnly, "a")).resolves.toBe("a");
    await expect(runtime.run(unmanaged, "b")).resolves.toBe("b");
  });

  it("enters the runtime through the frozen port and reuses terminal state on replay", async () => {
    let executions = 0;
    const action = defineAction({
      name: "host.port",
      version: "1",
      description: "Guarded side effect",
      input: text,
      output: text,
      effect: effects.guarded(),
      execute: (input) => {
        executions += 1;
        return `done:${input}`;
      },
    });
    const runtime = new OrdariumRuntime({ ledger: new MemoryLedger(), allowVolatileLedger: true });
    const port: HostInvocationPort = runtime;
    const invocation = {
      identity: { source: "test", scope: "host-port", callId: "call-1" },
      authorization: { decision: "allow", kind: "policy-decision", source: "test:policy" },
    } satisfies HostInvocation;

    await expect(port.invoke(action, "work", invocation)).resolves.toBe("done:work");
    await expect(port.invoke(action, "work", invocation)).resolves.toBe("done:work");
    expect(executions).toBe(1);
    expect((await runtime.ledger.list()).records).toHaveLength(1);
  });
});
