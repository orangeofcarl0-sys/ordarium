import { describe, expect, it } from "vitest";

import {
  MemoryLedger,
  OrdariumRuntime,
  PrincipalConflictError,
  defineAction,
  defineSchema,
  effects,
  type InvocationIdentity,
  type ProviderPrincipalRef,
} from "../src/index.js";

const text = defineSchema<string>({ type: "string" }, (value) => {
  if (typeof value !== "string") throw new TypeError("expected string");
  return value;
});

const identity: InvocationIdentity = { source: "test", scope: "principal", callId: "call-1" };
const allow = { decision: "allow", kind: "policy-decision", source: "test" } as const;
const accountA: ProviderPrincipalRef = { namespace: "tenant-1", subject: "user-a" };
const accountB: ProviderPrincipalRef = { namespace: "tenant-1", subject: "user-b" };

function guardedAction(name: string, executions: { count: number }) {
  return defineAction({
    name,
    version: "1",
    description: "Guarded side effect",
    input: text,
    output: text,
    effect: effects.guarded(),
    execute: (input) => {
      executions.count += 1;
      return `done:${input}`;
    },
  });
}

describe("provider principal continuity (G1-A11)", () => {
  it("persists only the digest and reuses the same operation for the same principal", async () => {
    const executions = { count: 0 };
    const action = guardedAction("principal.same", executions);
    const runtime = new OrdariumRuntime({ ledger: new MemoryLedger(), allowVolatileLedger: true });
    const options = { identity, authorization: allow, providerPrincipalRef: accountA };

    await expect(action.run(runtime, "work", options)).resolves.toBe("done:work");
    await expect(action.run(runtime, "work", options)).resolves.toBe("done:work");

    const [record] = (await runtime.ledger.list()).records;
    expect(record?.providerPrincipalDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(record)).not.toContain("user-a");
    expect(JSON.stringify(record)).not.toContain("tenant-1");
    expect(executions.count).toBe(1);
  });

  it("fails closed when a bound operation is retried with a different principal", async () => {
    const executions = { count: 0 };
    const action = guardedAction("principal.swap", executions);
    const runtime = new OrdariumRuntime({ ledger: new MemoryLedger(), allowVolatileLedger: true });

    await action.run(runtime, "work", { identity, authorization: allow, providerPrincipalRef: accountA });
    await expect(
      action.run(runtime, "work", { identity, authorization: allow, providerPrincipalRef: accountB }),
    ).rejects.toBeInstanceOf(PrincipalConflictError);
    await expect(
      action.run(runtime, "work", { identity, authorization: allow, providerPrincipalRef: accountB }),
    ).rejects.toMatchObject({ code: "PRINCIPAL_CONFLICT" });

    const [record] = (await runtime.ledger.list()).records;
    expect(record?.state).toBe("succeeded");
    expect(record?.providerPrincipalDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(executions.count).toBe(1);
  });

  it("fails closed when a bound operation is retried without any principal ref", async () => {
    const executions = { count: 0 };
    const action = guardedAction("principal.missing", executions);
    const runtime = new OrdariumRuntime({ ledger: new MemoryLedger(), allowVolatileLedger: true });

    await action.run(runtime, "work", { identity, authorization: allow, providerPrincipalRef: accountA });
    await expect(
      action.run(runtime, "work", { identity, authorization: allow }),
    ).rejects.toMatchObject({ code: "PRINCIPAL_CONFLICT" });
    expect(executions.count).toBe(1);
  });

  it("adopts the first presented principal for a previously unbound operation", async () => {
    const executions = { count: 0 };
    const action = guardedAction("principal.adopt", executions);
    const runtime = new OrdariumRuntime({ ledger: new MemoryLedger(), allowVolatileLedger: true });

    await action.run(runtime, "work", { identity, authorization: allow });
    const [first] = (await runtime.ledger.list()).records;
    expect(first?.providerPrincipalDigest).toBeUndefined();

    await expect(
      action.run(runtime, "work", { identity, authorization: allow, providerPrincipalRef: accountA }),
    ).resolves.toBe("done:work");
    const [bound] = (await runtime.ledger.list()).records;
    expect(bound?.providerPrincipalDigest).toMatch(/^[0-9a-f]{64}$/u);

    await expect(
      action.run(runtime, "work", { identity, authorization: allow, providerPrincipalRef: accountB }),
    ).rejects.toMatchObject({ code: "PRINCIPAL_CONFLICT" });
    expect(executions.count).toBe(1);
  });

  it("rejects malformed principal refs before persisting anything", async () => {
    const executions = { count: 0 };
    const action = guardedAction("principal.invalid", executions);
    const runtime = new OrdariumRuntime({ ledger: new MemoryLedger(), allowVolatileLedger: true });

    await expect(
      action.run(runtime, "work", {
        identity,
        authorization: allow,
        providerPrincipalRef: { namespace: "", subject: "user-a" },
      }),
    ).rejects.toThrow(/namespace/u);
    await expect(
      action.run(runtime, "work", {
        identity,
        authorization: allow,
        providerPrincipalRef: { namespace: "tenant-1", subject: "x".repeat(257) },
      }),
    ).rejects.toThrow(/subject/u);

    const [record] = (await runtime.ledger.list()).records;
    expect(record?.providerPrincipalDigest).toBeUndefined();
    expect(executions.count).toBe(0);
  });
});
