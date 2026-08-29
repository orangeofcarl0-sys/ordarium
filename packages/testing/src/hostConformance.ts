import {
  defineAction,
  defineSchema,
  effects,
  type AuthorizationDecision,
  type HostInvocation,
  type HostInvocationPort,
  type OperationLedger,
} from "@ordarium/core";

/**
 * Host adapter conformance (G18 design spec §1): the portable port-contract
 * scenarios every conformant host adapter must reproduce — replay
 * convergence, sibling separation, lineage passthrough and the
 * authorization gate. Framework-agnostic like the ledger conformance kits:
 * any violation throws a descriptive Error, so suites in any test runner
 * can drive them against a runtime wired to a scratch ledger. The probe
 * actions append real records, so never point this at production data.
 */

function violation(scenario: string, detail: string): Error {
  return new Error(`host adapter conformance violation: ${scenario}: ${detail}`);
}

const text = defineSchema<string>({ type: "string" }, (value) => {
  if (typeof value !== "string") throw new TypeError("expected string");
  return value;
});

function probeAction(name: string, executions: { count: number }) {
  return defineAction({
    name,
    version: "1",
    description: "Host adapter conformance probe",
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
  source: "host-conformance:policy",
};

function invocation(
  callId: string,
  overrides: { rootCallId?: string; actor?: string; lineage?: string[] } = {},
): HostInvocation {
  return {
    identity: {
      source: "host-conformance",
      scope: "conformance",
      callId,
      ...(overrides.rootCallId === undefined ? {} : { rootCallId: overrides.rootCallId }),
      ...(overrides.actor === undefined ? {} : { actor: overrides.actor }),
      ...(overrides.lineage === undefined ? {} : { lineage: overrides.lineage }),
    },
    authorization: allow,
  };
}

export async function runHostAdapterConformance(
  port: HostInvocationPort,
  ledger?: OperationLedger,
): Promise<void> {
  // Scenario 1 — replay convergence: the same callId must fold onto one
  // operation and execute exactly once.
  const replayExecutions = { count: 0 };
  const replay = probeAction("host-conformance.replay", replayExecutions);
  const first = await port.invoke(replay, "work", invocation("conformance-replay"));
  const second = await port.invoke(replay, "work", invocation("conformance-replay"));
  if (first !== "done:work" || second !== first) {
    throw violation("replay", "a replayed host call must resolve to the recorded result");
  }
  if (replayExecutions.count !== 1) {
    throw violation("replay", `expected 1 execution across the replay, saw ${replayExecutions.count}`);
  }

  // Scenario 2 — sibling separation: one root, distinct callIds, distinct
  // operations.
  const siblingExecutions = { count: 0 };
  const sibling = probeAction("host-conformance.siblings", siblingExecutions);
  await port.invoke(
    sibling,
    "a",
    invocation("conformance-sibling-a", { rootCallId: "conformance-root" }),
  );
  await port.invoke(
    sibling,
    "b",
    invocation("conformance-sibling-b", { rootCallId: "conformance-root" }),
  );
  if (siblingExecutions.count !== 2) {
    throw violation("siblings", `expected 2 sibling executions, saw ${siblingExecutions.count}`);
  }

  // Scenario 4 — the authorization gate: a guarded probe without a decision
  // fails closed with AUTHORIZATION_REQUIRED; the allow decision drives it.
  const authzExecutions = { count: 0 };
  const authz = probeAction("host-conformance.authz", authzExecutions);
  const denied: HostInvocation = {
    identity: { source: "host-conformance", scope: "conformance", callId: "conformance-authz-denied" },
  };
  try {
    await port.invoke(authz, "work", denied);
    throw violation("authorization", "a guarded probe without a decision must fail closed");
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code !== "AUTHORIZATION_REQUIRED") {
      throw violation("authorization", `expected AUTHORIZATION_REQUIRED, saw ${String(code)}`);
    }
  }
  await port.invoke(
    authz,
    "work",
    invocation("conformance-authz-allow"),
  );
  if (authzExecutions.count !== 1) {
    throw violation("authorization", "the allow decision must drive the guarded probe exactly once");
  }

  // Scenario 3 — lineage passthrough: actor/lineage travel into the record
  // for audit without affecting identity folding. Requires the ledger view;
  // hosts that cannot expose one skip the record-level assertions.
  if (ledger !== undefined) {
    const lineageExecutions = { count: 0 };
    const lineage = probeAction("host-conformance.lineage", lineageExecutions);
    const lineageCall: HostInvocation = {
      identity: {
        source: "host-conformance",
        scope: "conformance",
        callId: "conformance-lineage",
        rootCallId: "conformance-root",
        actor: "conformance-agent",
        lineage: ["conformance-root", "conformance-subagent"],
      },
      authorization: allow,
    };
    await port.invoke(lineage, "work", lineageCall);
    const { records } = await ledger.list();
    const replayRecords = records.filter((record) => record.identity.callId === "conformance-replay");
    if (replayRecords.length !== 1) {
      throw violation("replay", `expected 1 record for the replayed callId, saw ${replayRecords.length}`);
    }
    const siblingRecords = records.filter(
      (record) => record.identity.rootCallId === "conformance-root",
    );
    if (siblingRecords.length < 2) {
      throw violation("siblings", `expected both sibling records on the shared root, saw ${siblingRecords.length}`);
    }
    const lineageRecord = records.find((record) => record.identity.callId === "conformance-lineage");
    if (lineageRecord === undefined) {
      throw violation("lineage", "the lineage probe record is missing from the ledger");
    } else if (
      lineageRecord.identity.actor !== "conformance-agent" ||
      JSON.stringify(lineageRecord.identity.lineage) !==
        JSON.stringify(["conformance-root", "conformance-subagent"])
    ) {
      throw violation("lineage", "actor/lineage did not travel through the port into the record");
    }
  }
}
