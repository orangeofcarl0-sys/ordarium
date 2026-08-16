import { describe, expect, it } from "vitest";

import {
  MemoryLedger,
  OrdariumRuntime,
  defineAction,
  defineSchema,
  effects,
  hasExternalSideEffect,
  requiresAuthorization,
  usesOperationKey,
  type EffectProfile,
  type InvocationIdentity,
} from "../src/index.js";

const text = defineSchema<string>({ type: "string" }, (value) => {
  if (typeof value !== "string") throw new TypeError("expected string");
  return value;
});

const identity: InvocationIdentity = { source: "test", scope: "effects", callId: "call-1" };
const allow = { decision: "allow", kind: "policy-decision", source: "test" } as const;

function defineWith(profile: EffectProfile) {
  return defineAction({
    name: "effects.probe",
    version: "1",
    description: "Probe profile",
    input: text,
    output: text,
    effect: profile,
    execute: (input) => input,
  });
}

describe("EffectProfile discriminated union", () => {
  it("defaults effects.idempotent() to a durable window", () => {
    const profile = effects.idempotent();
    expect(profile).toEqual({ kind: "idempotent", window: { kind: "durable" } });
    expect(usesOperationKey(profile)).toBe(true);
  });

  it("accepts an explicit finite window with a positive safe-integer deadline", () => {
    const profile = effects.idempotent({
      window: { kind: "finite", expiresAfterMs: 3_600_000 },
    });
    expect(profile).toEqual({
      kind: "idempotent",
      window: { kind: "finite", expiresAfterMs: 3_600_000 },
    });
  });

  it("rejects malformed finite windows at definition time", () => {
    for (const expiresAfterMs of [0, -1, 1.5, Number.MAX_SAFE_INTEGER * 2]) {
      expect(() =>
        defineWith(effects.idempotent({ window: { kind: "finite", expiresAfterMs } })),
      ).toThrow(/expiresAfterMs/u);
    }
  });

  it("rejects unknown window kinds at definition time", () => {
    expect(() =>
      defineWith(effects.idempotent({ window: { kind: "ephemeral" } as never })),
    ).toThrow(/durable or finite/u);
  });

  it("defaults reconcilable to non-cancellable without an idempotency window", () => {
    const profile = effects.reconcilable();
    expect(profile).toEqual({ kind: "reconcilable", cancellable: false });
    expect(usesOperationKey(profile)).toBe(false);
    expect(usesOperationKey(effects.reconcilable({ idempotencyWindow: { kind: "durable" } })))
      .toBe(true);
  });

  it("derives authorization and side-effect semantics from the profile kind", () => {
    const matrix: [EffectProfile, boolean, boolean][] = [
      [effects.readOnly(), false, false],
      [effects.guarded(), true, true],
      [effects.idempotent(), true, true],
      [effects.reconcilable(), true, true],
      [effects.unmanaged(), false, true],
    ];
    for (const [profile, requiresAuth, sideEffect] of matrix) {
      expect(requiresAuthorization(profile), `${profile.kind} authorization`).toBe(requiresAuth);
      expect(hasExternalSideEffect(profile), `${profile.kind} side effect`).toBe(sideEffect);
    }
  });

  it("requires cancel() to be backed by a cancellable reconcilable profile", () => {
    expect(() =>
      defineAction({
        name: "effects.uncancellable",
        version: "1",
        description: "Cancel without a cancellable profile",
        input: text,
        output: text,
        effect: effects.guarded(),
        execute: (input) => input,
        cancel: () => undefined,
      }),
    ).toThrow(/cancellable reconcilable profile/u);

    expect(() =>
      defineAction({
        name: "effects.cancellable",
        version: "1",
        description: "Cancel with a cancellable profile",
        input: text,
        output: text,
        effect: effects.reconcilable({ cancellable: true }),
        execute: (input) => input,
        reconcile: () => ({ status: "unknown" }),
        cancel: () => undefined,
      }),
    ).not.toThrow();
  });

  it("persists the profile kind as the record guarantee", async () => {
    const runtime = new OrdariumRuntime({ ledger: new MemoryLedger() });
    await runtime.run(defineWith(effects.guarded()), "work", { identity, authorization: allow });
    const [record] = await runtime.ledger.list();
    expect(record?.guarantee).toBe("guarded");
  });
});
