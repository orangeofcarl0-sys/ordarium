import { describe, expect, it } from "vitest";

import {
  ActionDeniedError,
  AuthorizationConflictError,
  MemoryLedger,
  OrdariumRuntime,
  defineAction,
  defineSchema,
  effects,
  type AuthorizationDecision,
  type AuthorizationEvidenceKind,
  type InvocationIdentity,
} from "../src/index.js";

const text = defineSchema<string>({ type: "string" }, (value) => {
  if (typeof value !== "string") throw new TypeError("expected string");
  return value;
});

const identity: InvocationIdentity = { source: "test", scope: "auth", callId: "call-1" };

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

const allow: AuthorizationDecision = {
  decision: "allow",
  kind: "policy-decision",
  source: "test:policy",
};
const deny: AuthorizationDecision = {
  decision: "deny",
  kind: "policy-decision",
  source: "test:policy",
};

describe("classified authorization evidence", () => {
  it("rejects contradictory evidence after a durable allow (G1-A02)", async () => {
    const executions = { count: 0 };
    const action = guardedAction("auth.allow-first", executions);
    const runtime = new OrdariumRuntime({ ledger: new MemoryLedger() });

    await expect(action.run(runtime, "work", { identity, authorization: allow }))
      .resolves.toBe("done:work");
    await expect(action.run(runtime, "work", { identity, authorization: deny }))
      .rejects.toBeInstanceOf(AuthorizationConflictError);
    await expect(action.run(runtime, "work", { identity, authorization: deny }))
      .rejects.toMatchObject({ code: "AUTHORIZATION_CONFLICT" });

    const [record] = await runtime.ledger.list();
    expect(record?.state).toBe("succeeded");
    expect(record?.authorization).toMatchObject({ decision: "allow", kind: "policy-decision" });
    expect(executions.count).toBe(1);
  });

  it("rejects contradictory evidence after a durable deny (G1-A02)", async () => {
    const executions = { count: 0 };
    const action = guardedAction("auth.deny-first", executions);
    const runtime = new OrdariumRuntime({ ledger: new MemoryLedger() });

    await expect(action.run(runtime, "work", { identity, authorization: deny }))
      .rejects.toBeInstanceOf(ActionDeniedError);
    await expect(action.run(runtime, "work", { identity, authorization: allow }))
      .rejects.toMatchObject({ code: "AUTHORIZATION_CONFLICT" });

    const [record] = await runtime.ledger.list();
    expect(record?.state).toBe("denied");
    expect(record?.authorization?.decision).toBe("deny");
    expect(executions.count).toBe(0);
  });

  it("accepts consistent evidence on re-entry without touching the persisted decision", async () => {
    const executions = { count: 0 };
    const action = guardedAction("auth.consistent", executions);
    const runtime = new OrdariumRuntime({ ledger: new MemoryLedger() });

    await expect(action.run(runtime, "work", { identity, authorization: allow }))
      .resolves.toBe("done:work");
    await expect(action.run(runtime, "work", { identity, authorization: allow }))
      .resolves.toBe("done:work");
    expect(executions.count).toBe(1);
  });

  it("rejects unknown evidence kinds before any authorization is persisted", async () => {
    const executions = { count: 0 };
    const action = guardedAction("auth.bad-kind", executions);
    const runtime = new OrdariumRuntime({ ledger: new MemoryLedger() });

    await expect(
      action.run(runtime, "work", {
        identity,
        authorization: {
          decision: "allow",
          kind: "magic" as AuthorizationEvidenceKind,
          source: "test",
        },
      }),
    ).rejects.toThrow(/host-admission, policy-decision or human-approval/);

    const [record] = await runtime.ledger.list();
    expect(record?.state).toBe("proposed");
    expect(record?.authorization).toBeUndefined();
    expect(executions.count).toBe(0);
  });

  it("persists trusted human-approval evidence exactly as the host adapter provided it", async () => {
    const executions = { count: 0 };
    const action = guardedAction("auth.human", executions);
    const runtime = new OrdariumRuntime({ ledger: new MemoryLedger() });

    await expect(
      action.run(runtime, "work", {
        identity,
        authorization: { decision: "allow", kind: "human-approval", source: "test:approval" },
      }),
    ).resolves.toBe("done:work");

    const [record] = await runtime.ledger.list();
    expect(record?.authorization).toMatchObject({ kind: "human-approval", source: "test:approval" });
  });

  it("classifies implicit allows for non-authorizing profiles as host-admission", async () => {
    const action = defineAction({
      name: "auth.readonly",
      version: "1",
      description: "Read",
      input: text,
      output: text,
      effect: effects.readOnly(),
      execute: (input) => input,
    });
    const runtime = new OrdariumRuntime({ ledger: new MemoryLedger() });

    await expect(action.run(runtime, "work", { identity })).resolves.toBe("work");
    const [record] = await runtime.ledger.list();
    expect(record?.authorization).toMatchObject({
      decision: "allow",
      kind: "host-admission",
      source: "implicit:read-only",
    });
  });
});
