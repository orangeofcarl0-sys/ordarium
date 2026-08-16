import { describe, expect, it } from "vitest";

import {
  ContractDriftError,
  MemoryLedger,
  OrdariumRuntime,
  contractFingerprint,
  defineAction,
  defineSchema,
  effects,
  type InvocationIdentity,
} from "../src/index.js";

const text = defineSchema<string>({ type: "string" }, (value) => {
  if (typeof value !== "string") throw new TypeError("expected string");
  return value;
});
const upperBound = defineSchema<string>(
  { type: "string", maxLength: 4 },
  (value) => {
    if (typeof value !== "string") throw new TypeError("expected string");
    return value;
  },
);

const identity: InvocationIdentity = { source: "test", scope: "fingerprint", callId: "call-1" };
const allow = { decision: "allow", kind: "policy-decision", source: "test" } as const;

function guardedAction(output = text, effect = effects.guarded()) {
  return defineAction({
    name: "fingerprint.probe",
    version: "1",
    description: "Contract fingerprint probe",
    input: text,
    output,
    effect,
    execute: (input) => input,
  });
}

describe("action contract fingerprint (G1-A04)", () => {
  it("is stable for re-defined identical contracts and excludes the description", () => {
    const first = guardedAction();
    const second = defineAction({
      name: "fingerprint.probe",
      version: "1",
      description: "A totally different description",
      input: text,
      output: text,
      effect: effects.guarded(),
      execute: (input) => input,
    });
    expect(contractFingerprint(first)).toBe(contractFingerprint(second));
    expect(contractFingerprint(first)).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("changes when schemas, effect windows or hook presence change", () => {
    const base = guardedAction();
    expect(contractFingerprint(guardedAction(upperBound))).not.toBe(contractFingerprint(base));
    expect(
      contractFingerprint(guardedAction(text, effects.idempotent())),
    ).not.toBe(contractFingerprint(base));

    const withKey = defineAction({
      name: "fingerprint.probe",
      version: "1",
      description: "Contract fingerprint probe",
      input: text,
      output: text,
      effect: effects.guarded(),
      key: () => "stable",
      execute: (input) => input,
    });
    expect(contractFingerprint(withKey)).not.toBe(contractFingerprint(base));
  });

  it("fails closed when metadata drifts under an unchanged name and version", async () => {
    let executions = 0;
    const original = defineAction({
      name: "fingerprint.drift",
      version: "1",
      description: "Drifting action",
      input: text,
      output: text,
      effect: effects.guarded(),
      execute: (input) => {
        executions += 1;
        return input;
      },
    });
    const drifted = defineAction({
      name: "fingerprint.drift",
      version: "1",
      description: "Drifting action",
      input: text,
      output: text,
      effect: effects.idempotent(),
      execute: (input) => {
        executions += 1;
        return input;
      },
    });
    const runtime = new OrdariumRuntime({
      ledger: new MemoryLedger(),
      allowVolatileLedger: true,
    });

    await expect(original.run(runtime, "work", { identity, authorization: allow }))
      .resolves.toBe("work");
    await expect(drifted.run(runtime, "work", { identity, authorization: allow }))
      .rejects.toBeInstanceOf(ContractDriftError);
    await expect(drifted.run(runtime, "work", { identity, authorization: allow }))
      .rejects.toMatchObject({ code: "CONTRACT_DRIFT" });

    const [record] = (await runtime.ledger.list()).records;
    expect(record?.state).toBe("succeeded");
    expect(record?.contractFingerprint).toBe(contractFingerprint(original));
    expect(executions).toBe(1);
  });

  it("re-enters cleanly when the contract matches the durable fingerprint", async () => {
    let executions = 0;
    const make = () =>
      defineAction({
        name: "fingerprint.stable",
        version: "1",
        description: "Stable action",
        input: text,
        output: text,
        effect: effects.guarded(),
        execute: (input) => {
          executions += 1;
          return input;
        },
      });
    const runtime = new OrdariumRuntime({
      ledger: new MemoryLedger(),
      allowVolatileLedger: true,
    });

    await expect(make().run(runtime, "work", { identity, authorization: allow }))
      .resolves.toBe("work");
    await expect(make().run(runtime, "work", { identity, authorization: allow }))
      .resolves.toBe("work");
    expect(executions).toBe(1);
    const [record] = (await runtime.ledger.list()).records;
    expect(record?.contractFingerprint).toMatch(/^[0-9a-f]{64}$/u);
  });
});
