import { describe, expect, it } from "vitest";

import {
  MemoryLedger,
  OrdariumRuntime,
  decodeOperationRecord,
  defineAction,
  defineSchema,
  effects,
  type OperationRecord,
} from "../src/index.js";

const text = defineSchema<string>({ type: "string" }, (value) => {
  if (typeof value !== "string") throw new TypeError("expected string");
  return value;
});

function baseRecord(overrides: Partial<OperationRecord> = {}): OperationRecord {
  return {
    schemaVersion: 1,
    operationId: `op_${"0".repeat(40)}`,
    actionName: "codec.probe",
    actionVersion: "1",
    inputDigest: "a".repeat(64),
    logicalKeyDigest: "b".repeat(64),
    identity: { source: "test", scope: "codec", callId: "call-1" },
    guarantee: "guarded",
    state: "proposed",
    revision: 0,
    attempts: 0,
    lastFencingToken: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as OperationRecord;
}

function authorizedRecord(): OperationRecord {
  return baseRecord({
    state: "authorized",
    revision: 1,
    updatedAt: "2026-01-01T00:00:01.000Z",
    authorization: {
      decision: "allow",
      kind: "policy-decision",
      source: "test:policy",
      at: "2026-01-01T00:00:01.000Z",
    },
  });
}

describe("OperationRecord codec (G1-A06)", () => {
  it("round-trips a valid record", () => {
    const record = authorizedRecord();
    expect(decodeOperationRecord(structuredClone(record))).toEqual(record);
  });

  it("rejects nested field damage", () => {
    const cases: [string, unknown][] = [
      ["bad schema version", { ...baseRecord(), schemaVersion: 2 }],
      ["unknown state", { ...baseRecord(), state: "finished" }],
      ["unknown effect kind", { ...baseRecord(), guarantee: "trustworthy" }],
      ["short digest", { ...baseRecord(), inputDigest: "a".repeat(63) }],
      ["non-hex digest", { ...baseRecord(), logicalKeyDigest: "z".repeat(64) }],
      ["bad principal digest", { ...baseRecord(), providerPrincipalDigest: "nope" }],
      ["empty identity source", {
        ...baseRecord(),
        identity: { source: "", scope: "codec", callId: "call-1" },
      }],
      ["oversized identity field", {
        ...baseRecord(),
        identity: { source: "x".repeat(257), scope: "codec", callId: "call-1" },
      }],
      ["too many lineage entries", {
        ...baseRecord(),
        identity: { source: "test", scope: "codec", callId: "call-1", lineage: Array(65).fill("n") },
      }],
      ["bad authorization kind", {
        ...authorizedRecord(),
        authorization: {
          decision: "allow",
          kind: "magic",
          source: "test",
          at: "2026-01-01T00:00:01.000Z",
        },
      }],
      ["oversized reason", {
        ...authorizedRecord(),
        authorization: {
          decision: "allow",
          kind: "policy-decision",
          source: "test",
          reason: "r".repeat(4_097),
          at: "2026-01-01T00:00:01.000Z",
        },
      }],
      ["bad safe error code", {
        ...baseRecord({ state: "failed", revision: 3, error: { code: "nope", message: "x" } }),
      }],
      ["bad timestamp", { ...baseRecord(), createdAt: "not-a-date" }],
      ["negative revision", { ...baseRecord(), revision: -1 }],
      ["array record", [baseRecord()]],
      ["null record", null],
    ];
    for (const [label, corrupt] of cases) {
      expect(() => decodeOperationRecord(corrupt), label).toThrow();
    }
  });

  it("rejects cross-state invariant violations", () => {
    const at = "2026-01-01T00:00:02.000Z";
    const cases: [string, OperationRecord][] = [
      ["revision 0 past proposed", baseRecord({ state: "authorized" })],
      ["proposed with authorization", baseRecord({
        authorization: { decision: "allow", kind: "host-admission", source: "s", at },
      })],
      ["authorized without allow", baseRecord({
        state: "authorized",
        revision: 1,
        authorization: { decision: "deny", kind: "policy-decision", source: "s", at },
      })],
      ["denied without deny", baseRecord({
        state: "denied",
        revision: 1,
        authorization: { decision: "allow", kind: "policy-decision", source: "s", at },
      })],
      ["claim in a terminal state", baseRecord({
        state: "succeeded",
        revision: 2,
        result: "ok",
        claim: { owner: "runtime-x", expiresAt: at, fencingToken: 1 },
        lastFencingToken: 1,
      })],
      ["claim fence behind lastFencingToken", baseRecord({
        state: "claimed",
        revision: 2,
        resumeFrom: "authorized",
        claim: { owner: "runtime-x", expiresAt: at, fencingToken: 1 },
        lastFencingToken: 7,
      })],
      ["resumeFrom outside claimed", baseRecord({ state: "dispatched", revision: 2, resumeFrom: "authorized" })],
      ["uncertainty outside its states", baseRecord({
        state: "authorized",
        revision: 1,
        uncertainty: { reason: "stale", at },
      })],
      ["succeeded without result", baseRecord({ state: "succeeded", revision: 2 })],
      ["failed without error", baseRecord({ state: "failed", revision: 2 })],
      ["reconciled without outcome", baseRecord({ state: "reconciled", revision: 2 })],
    ];
    for (const [label, corrupt] of cases) {
      expect(() => decodeOperationRecord(structuredClone(corrupt)), label).toThrow(/Corrupt/u);
    }
  });

  it("keeps uncertainty valid while an uncertain operation is being recovered", () => {
    const record = baseRecord({
      state: "claimed",
      revision: 3,
      resumeFrom: "uncertain",
      lastFencingToken: 2,
      claim: { owner: "runtime-x", expiresAt: at2(), fencingToken: 2 },
      uncertainty: { reason: "execution-threw-after-dispatch", at: at2() },
    });
    expect(() => decodeOperationRecord(record)).not.toThrow();
  });

  it("fail-closes MemoryLedger writes and reads around corrupt records", async () => {
    const ledger = new MemoryLedger();
    const valid = authorizedRecord();
    await ledger.create(valid);
    const stored = (await ledger.list())[0] as OperationRecord;

    const corrupt = { ...stored, revision: stored.revision + 1, state: "succeeded" } as OperationRecord;
    await expect(ledger.compareAndSet(stored.operationId, stored.revision, corrupt))
      .rejects.toThrow(/Corrupt/u);
    await expect(
      ledger.create({ ...baseRecord({ state: "denied" }), operationId: `op_${"1".repeat(40)}` } as OperationRecord),
    ).rejects.toThrow();
  });
});

function at2(): string {
  return "2026-01-01T00:00:05.000Z";
}

describe("resource envelope (G1-A07)", () => {
  it("rejects oversized canonical input before anything is persisted", async () => {
    let executions = 0;
    const action = defineAction({
      name: "envelope.biginput",
      version: "1",
      description: "Oversized input probe",
      input: defineSchema<{ value: string }>(
        { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
        (value) => {
          if (value === null || typeof value !== "object" || typeof (value as { value?: unknown }).value !== "string") {
            throw new TypeError("expected { value: string }");
          }
          return value as { value: string };
        },
      ),
      output: text,
      effect: effects.guarded(),
      execute: (input) => {
        executions += 1;
        return input.value.slice(0, 1);
      },
    });
    const runtime = new OrdariumRuntime({ ledger: new MemoryLedger() });

    await expect(
      action.run(runtime, { value: "x".repeat(1_048_577) }, {
        identity: { source: "test", scope: "envelope", callId: "call-1" },
        authorization: { decision: "allow", kind: "policy-decision", source: "test" },
      }),
    ).rejects.toMatchObject({ code: "INPUT_TOO_LARGE" });

    expect(await runtime.ledger.list()).toHaveLength(0);
    expect(executions).toBe(0);
  });

  it("rejects oversized identity fields and lineage at the entry boundary", async () => {
    const action = defineAction({
      name: "envelope.identity",
      version: "1",
      description: "Identity envelope probe",
      input: text,
      output: text,
      effect: effects.guarded(),
      execute: (input) => input,
    });
    const runtime = new OrdariumRuntime({ ledger: new MemoryLedger() });

    await expect(
      action.run(runtime, "work", {
        identity: { source: "s".repeat(257), scope: "envelope", callId: "call-1" },
        authorization: { decision: "allow", kind: "policy-decision", source: "test" },
      }),
    ).rejects.toThrow(/identity source/u);
    await expect(
      action.run(runtime, "work", {
        identity: { source: "test", scope: "envelope", callId: "call-1", lineage: Array(65).fill("n") },
        authorization: { decision: "allow", kind: "policy-decision", source: "test" },
      }),
    ).rejects.toThrow(/lineage/u);

    expect(await runtime.ledger.list()).toHaveLength(0);
  });
});
