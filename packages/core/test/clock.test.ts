import { describe, expect, it } from "vitest";

import {
  MemoryLedger,
  OperationBusyError,
  OrdariumRuntime,
  SimulatedProcessCrash,
  UncertainOperationError,
  defineAction,
  defineSchema,
  effects,
  type InvocationIdentity,
} from "../src/index.js";

const text = defineSchema<string>({ type: "string" }, (value) => {
  if (typeof value !== "string") throw new TypeError("expected string");
  return value;
});

const identity: InvocationIdentity = { source: "test", scope: "clock", callId: "call-1" };
const allow = { decision: "allow", kind: "policy-decision", source: "test" } as const;

function guardedHeld(name: string, executions: { count: number }, release: Promise<void>) {
  return defineAction({
    name,
    version: "1",
    description: "Clock fixture action",
    input: text,
    output: text,
    effect: effects.guarded(),
    async execute(input, context) {
      executions.count += 1;
      await new Promise<void>((resolve) => {
        const stop = () => resolve();
        context.signal.addEventListener("abort", stop, { once: true });
        release.then(stop, stop);
      });
      return `done:${input}`;
    },
  });
}

describe("clock jumps and stalls (G3 spec §5, G3-A07)", () => {
  it("a forward jump past the lease hands exactly one new owner the takeover", async () => {
    const ledger = new MemoryLedger();
    let clockMs = Date.parse("2026-01-01T00:00:00.000Z");
    const clock = () => new Date(clockMs);
    const executions = { count: 0 };
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const action = guardedHeld("clock.forward", executions, held);

    const stalled = new OrdariumRuntime({
      ledger, clock, ownerId: "stalled", leaseMs: 1_000, allowVolatileLedger: true,
    });
    const running = action.run(stalled, "work", { identity, authorization: allow });
    await new Promise((resolve) => setTimeout(resolve, 20));

    // The owner's event loop stalls; the shared clock moves past its lease.
    clockMs = Date.parse("2026-01-01T00:00:05.000Z");
    const replacement = new OrdariumRuntime({
      ledger, clock, ownerId: "replacement", allowVolatileLedger: true,
    });
    await expect(action.run(replacement, "work", { identity, authorization: allow }))
      .rejects.toBeInstanceOf(UncertainOperationError);

    release();
    await expect(running).rejects.toBeInstanceOf(OperationBusyError);

    const [record] = (await ledger.list()).records;
    expect(record?.state).toBe("uncertain");
    expect(record?.lastFencingToken).toBeGreaterThanOrEqual(2);
    await replacement.dispose();
  });

  it("a backward jump does not fabricate expiry or a second local owner", async () => {
    const ledger = new MemoryLedger();
    let clockMs = Date.parse("2026-01-01T12:00:00.000Z");
    const clock = () => new Date(clockMs);
    const executions = { count: 0 };
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const action = guardedHeld("clock.backward", executions, held);

    const owner = new OrdariumRuntime({
      ledger, clock, ownerId: "owner", leaseMs: 30_000, allowVolatileLedger: true,
    });
    const running = action.run(owner, "work", { identity, authorization: allow });
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Wall clock jumps backwards well before the lease was acquired.
    clockMs = Date.parse("2026-01-01T00:00:00.000Z");
    const intruder = new OrdariumRuntime({
      ledger, clock, ownerId: "intruder", allowVolatileLedger: true,
    });
    await expect(action.run(intruder, "work", { identity, authorization: allow }))
      .rejects.toBeInstanceOf(OperationBusyError);

    release();
    await expect(running).resolves.toBe("done:work");
    expect(executions.count).toBe(1);
    await owner.dispose();
  });
});

describe("crash checkpoint matrix (G3 spec §7, G3-A01–A03)", () => {
  it("a crash after the claim, before dispatch, leaves no Provider call and a recoverable claim", async () => {
    const ledger = new MemoryLedger();
    const executions = { count: 0 };
    const action = defineAction({
      name: "clock.pre-dispatch",
      version: "1",
      description: "Crash before dispatch",
      input: text,
      output: text,
      effect: effects.guarded(),
      execute: (input) => {
        executions.count += 1;
        return `done:${input}`;
      },
    });

    const first = new OrdariumRuntime({
      ledger,
      allowVolatileLedger: true,
      hooks: {
        checkpoint: (name) => {
          if (name === "after-claim") throw new SimulatedProcessCrash();
        },
      },
    });
    await expect(action.run(first, "work", { identity, authorization: allow }))
      .rejects.toMatchObject({ code: "SIMULATED_PROCESS_CRASH" });
    expect(executions.count).toBe(0);

    const second = new OrdariumRuntime({ ledger, allowVolatileLedger: true });
    await expect(action.run(second, "work", { identity, authorization: allow }))
      .resolves.toBe("done:work");
    expect(executions.count).toBe(1);
    await second.dispose();
  });

  it("a crash after the durable dispatch is treated as unknown, never as an ordinary failure", async () => {
    const ledger = new MemoryLedger();
    const executions = { count: 0 };
    const action = defineAction({
      name: "clock.post-dispatch",
      version: "1",
      description: "Crash after dispatch before the request",
      input: text,
      output: text,
      effect: effects.guarded(),
      execute: (input) => {
        executions.count += 1;
        return `done:${input}`;
      },
    });

    const runtime = new OrdariumRuntime({
      ledger,
      allowVolatileLedger: true,
      hooks: {
        checkpoint: (name) => {
          if (name === "after-dispatch") throw new SimulatedProcessCrash();
        },
      },
    });
    await expect(action.run(runtime, "work", { identity, authorization: allow }))
      .rejects.toMatchObject({ code: "SIMULATED_PROCESS_CRASH" });
    expect(executions.count).toBe(0); // The Provider was never reached.

    const [record] = (await ledger.list()).records;
    expect(record?.state).toBe("dispatched");
    await runtime.dispose();
  });
});
