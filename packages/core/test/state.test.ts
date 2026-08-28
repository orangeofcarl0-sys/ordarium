import { describe, expect, it } from "vitest";

import {
  MemoryLedger,
  OrdariumRuntime,
  RESOURCE_LIMITS,
  RuntimeQuiescingError,
  StateRefNotFoundError,
  StateRevisionConflictError,
  createStateStore,
  decodeStateRecord,
  defineAction,
  defineSchema,
  digestJson,
  effects,
  encodeStateRefId,
  type InvocationIdentity,
  type JsonValue,
  type OperationLedger,
  type StateRecord,
  type StateWriteRequest,
} from "../src/index.js";

const text = defineSchema<string>({ type: "string" }, (value) => {
  if (typeof value !== "string") throw new TypeError("expected string");
  return value;
});

const identity: InvocationIdentity = { source: "test", scope: "state", callId: "call-1" };

let clockMs = Date.parse("2026-01-01T00:00:00.000Z");
const clock = (): Date => new Date(clockMs);

function stateRecord(overrides: Partial<StateRecord> = {}): StateRecord {
  const value = overrides.value ?? { plan: "step-1" };
  return {
    schemaVersion: 1,
    namespace: "palimpsest",
    key: "plan",
    revision: 1,
    value,
    valueDigest: digestJson(value as JsonValue),
    refs: [],
    identity,
    writtenAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function writeRequest(overrides: Partial<StateWriteRequest> = {}): StateWriteRequest {
  return {
    namespace: "palimpsest",
    key: "plan",
    expectedRevision: 0,
    value: { plan: "step-1" },
    identity,
    ...overrides,
  };
}

/** Delegating wrapper that fakes a ledger without the state kind capability. */
class NoStateLedger implements OperationLedger {
  readonly capabilities = {
    durability: "crash-durable",
    coordination: "local-multi-process",
    semanticCas: true,
    liveLease: true,
    semanticHistory: true,
    stateRevisions: false,
  } as const;
  readonly #inner: OperationLedger;

  constructor(inner: OperationLedger) {
    this.#inner = inner;
  }

  get(operationId: string) {
    return this.#inner.get(operationId);
  }
  create(...args: Parameters<OperationLedger["create"]>) {
    return this.#inner.create(...args);
  }
  compareAndSet(...args: Parameters<OperationLedger["compareAndSet"]>) {
    return this.#inner.compareAndSet(...args);
  }
  claim(...args: Parameters<OperationLedger["claim"]>) {
    return this.#inner.claim(...args);
  }
  lease(operationId: string) {
    return this.#inner.lease(operationId);
  }
  renewLease(...args: Parameters<OperationLedger["renewLease"]>) {
    return this.#inner.renewLease(...args);
  }
  history(...args: Parameters<OperationLedger["history"]>) {
    return this.#inner.history(...args);
  }
  list(...args: Parameters<OperationLedger["list"]>) {
    return this.#inner.list(...args);
  }
  getState(namespace: string, key: string) {
    return this.#inner.getState(namespace, key);
  }
  compareAndSetState(...args: Parameters<OperationLedger["compareAndSetState"]>) {
    return this.#inner.compareAndSetState(...args);
  }
  stateHistory(...args: Parameters<OperationLedger["stateHistory"]>) {
    return this.#inner.stateHistory(...args);
  }
  listStatesReferencing(...args: Parameters<OperationLedger["listStatesReferencing"]>) {
    return this.#inner.listStatesReferencing(...args);
  }
  listStates(...args: Parameters<OperationLedger["listStates"]>) {
    return this.#inner.listStates(...args);
  }
}

describe("state record codec (G11)", () => {
  it("round-trips a valid record and re-derives the digest invariant", () => {
    const record = stateRecord({ refs: [{ kind: "operation", id: `op_${"a".repeat(40)}` }] });
    expect(decodeStateRecord(structuredClone(record))).toEqual(record);
  });

  it("rejects a value whose digest does not match its content", () => {
    const record = stateRecord();
    record.value = { plan: "tampered" };
    expect(() => decodeStateRecord(record)).toThrow(/valueDigest does not match/);
  });

  it("rejects subject parts that would break reference id parsing", () => {
    expect(() => decodeStateRecord(stateRecord({ namespace: "has/slash" }))).toThrow(/must match/);
    expect(() => decodeStateRecord(stateRecord({ key: "has@at" }))).toThrow(/must match/);
    expect(() =>
      decodeStateRecord(stateRecord({ namespace: "x".repeat(RESOURCE_LIMITS.maxStateSubjectLength + 1) })),
    ).toThrow(/must be a string/);
  });

  it("rejects revision 0 and unparseable state reference ids", () => {
    expect(() => decodeStateRecord(stateRecord({ revision: 0 }))).toThrow(/positive safe integer/);
    expect(() =>
      decodeStateRecord(stateRecord({ refs: [{ kind: "state", id: "not-a-reference" }] })),
    ).toThrow(/namespace\/key@revision/);
    expect(() =>
      decodeStateRecord(stateRecord({ refs: [{ kind: "state", id: "palimpsest/plan@0" }] })),
    ).toThrow(/namespace\/key@revision/);
  });
});

describe("state store gates (G11-A04/A06/A07)", () => {
  it("fails a state write on a ledger without the state capability before anything is written", async () => {
    const ledger = new NoStateLedger(new MemoryLedger());
    const store = createStateStore({ ledger });

    await expect(store.write(writeRequest())).rejects.toMatchObject({
      code: "LEDGER_CAPABILITY_REQUIRED",
    });
    expect(await ledger.listStates()).toMatchObject({ records: [] });
  });

  it("honors the runtime lifecycle on writes", async () => {
    const runtime = new OrdariumRuntime({ ledger: new MemoryLedger() });
    const store = createStateStore({ runtime });
    await runtime.quiesce();
    await expect(store.write(writeRequest())).rejects.toBeInstanceOf(RuntimeQuiescingError);
    await runtime.dispose();
    await expect(store.write(writeRequest())).rejects.toMatchObject({ code: "RUNTIME_CLOSED" });
  });

  it("enforces the state value persistence limit", async () => {
    const store = createStateStore({ ledger: new MemoryLedger(), maxValueJsonBytes: 16 });
    await expect(
      store.write(writeRequest({ value: "x".repeat(20) })),
    ).rejects.toMatchObject({ code: "PERSISTED_VALUE_TOO_LARGE" });
  });
});

describe("state reference integrity (G11-A03)", () => {
  it("fails closed on a dangling operation reference", async () => {
    const store = createStateStore({ ledger: new MemoryLedger(), clock });
    await expect(
      store.write(writeRequest({ refs: [{ kind: "operation", id: `op_${"b".repeat(40)}` }] })),
    ).rejects.toBeInstanceOf(StateRefNotFoundError);
  });

  it("accepts an existing operation reference and rejects a dangling state reference", async () => {
    const ledger = new MemoryLedger();
    const runtime = new OrdariumRuntime({ ledger });
    const store = createStateStore({ ledger, clock });
    const readAction = defineAction({
      name: "state.read",
      version: "1",
      description: "Read",
      input: text,
      output: text,
      effect: effects.readOnly(),
      execute: async (input) => input,
    });
    await runtime.run(readAction, "work", { identity });
    const operation = (await ledger.list()).records[0];
    expect(operation).toBeDefined();

    await expect(
      store.write(writeRequest({ refs: [{ kind: "operation", id: operation!.operationId }] })),
    ).resolves.toMatchObject({ revision: 1 });

    await expect(
      store.write(
        writeRequest({
          key: "gates",
          refs: [{ kind: "state", id: encodeStateRefId("palimpsest", "plan", 2) }],
        }),
      ),
    ).rejects.toBeInstanceOf(StateRefNotFoundError);
  });
});

describe("revision CAS and history (G11-A01/A02)", () => {
  it("creates on revision 0, then chains strictly through CAS", async () => {
    const store = createStateStore({ ledger: new MemoryLedger(), clock });
    const first = await store.write(writeRequest({ value: { plan: "v1" } }));
    expect(first).toMatchObject({ revision: 1, valueDigest: digestJson({ plan: "v1" }) });

    await expect(
      store.write(writeRequest({ value: { plan: "again" } })),
    ).rejects.toMatchObject({ code: "STATE_REVISION_CONFLICT" });

    await expect(
      store.write(writeRequest({ expectedRevision: 5, value: { plan: "far" } })),
    ).rejects.toMatchObject({ code: "STATE_REVISION_CONFLICT" });

    const second = await store.write(
      writeRequest({ expectedRevision: 1, value: { plan: "v2" } }),
    );
    expect(second).toMatchObject({ revision: 2 });
    expect(await store.get("palimpsest", "plan")).toMatchObject({ revision: 2, value: { plan: "v2" } });
  });

  it("describes the conflicting current revision in the error", async () => {
    const store = createStateStore({ ledger: new MemoryLedger(), clock });
    await store.write(writeRequest());
    await expect(store.write(writeRequest({ expectedRevision: 0 }))).rejects.toThrow(
      /is at revision 1; expected 0/,
    );
  });

  it("rejects a record whose subject does not match its CAS coordinates", async () => {
    const ledger = new MemoryLedger();
    expect(
      await ledger.compareAndSetState("other", "plan", 0, stateRecord()),
    ).toBe(false);
    expect(
      await ledger.compareAndSetState("palimpsest", "other", 0, stateRecord()),
    ).toBe(false);
  });

  it("pages the revision chain and returns an empty page for an absent subject", async () => {
    const store = createStateStore({ ledger: new MemoryLedger(), clock });
    for (const version of ["v1", "v2", "v3"]) {
      const current = await store.get("palimpsest", "plan");
      await store.write(
        writeRequest({ expectedRevision: current?.revision ?? 0, value: { plan: version } }),
      );
    }

    const firstPage = await store.history("palimpsest", "plan", undefined, 2);
    expect(firstPage.revisions.map((record) => record.value)).toEqual([{ plan: "v1" }, { plan: "v2" }]);
    expect(firstPage.nextCursor).toBeDefined();

    const secondPage = await store.history("palimpsest", "plan", firstPage.nextCursor, 2);
    expect(secondPage.revisions.map((record) => record.value)).toEqual([{ plan: "v3" }]);
    expect(secondPage.nextCursor).toBeUndefined();

    expect(await store.history("palimpsest", "absent", undefined, 10)).toMatchObject({ revisions: [] });
  });
});

describe("derived views (G11-A03/A10)", () => {
  it("reverse-lists state revisions by operation and state reference with paging", async () => {
    const ledger = new MemoryLedger();
    const runtime = new OrdariumRuntime({ ledger });
    const store = createStateStore({ ledger, clock });
    const readAction = defineAction({
      name: "state.read",
      version: "1",
      description: "Read",
      input: text,
      output: text,
      effect: effects.readOnly(),
      execute: async (input) => input,
    });
    await runtime.run(readAction, "work", { identity });
    const operation = (await ledger.list()).records[0];
    expect(operation).toBeDefined();

    await store.write(
      writeRequest({ refs: [{ kind: "operation", id: operation!.operationId }] }),
    );
    await store.write(
      writeRequest({
        expectedRevision: 1,
        value: { plan: "v2" },
        refs: [{ kind: "operation", id: operation!.operationId }],
      }),
    );
    await store.write(
      writeRequest({
        key: "gates",
        refs: [{ kind: "state", id: encodeStateRefId("palimpsest", "plan", 2) }],
      }),
    );

    const byOperation = await store.listReferencing(
      { kind: "operation", id: operation!.operationId },
      undefined,
      1,
    );
    expect(byOperation.records).toHaveLength(1);
    expect(byOperation.records[0]).toMatchObject({ key: "plan", revision: 1 });
    expect(byOperation.nextCursor).toBeDefined();

    const byOperationRest = await store.listReferencing(
      { kind: "operation", id: operation!.operationId },
      byOperation.nextCursor,
      10,
    );
    expect(byOperationRest.records).toHaveLength(1);
    expect(byOperationRest.records[0]).toMatchObject({ key: "plan", revision: 2 });

    const byState = await store.listReferencing(
      { kind: "state", id: encodeStateRefId("palimpsest", "plan", 2) },
      undefined,
      undefined,
    );
    expect(byState.records).toHaveLength(1);
    expect(byState.records[0]).toMatchObject({ key: "gates", revision: 1 });

    expect(
      await store.listReferencing({ kind: "operation", id: `op_${"c".repeat(40)}` }, undefined, undefined),
    ).toMatchObject({ records: [] });
  });

  it("lists current revisions per subject with a namespace filter", async () => {
    const store = createStateStore({ ledger: new MemoryLedger(), clock });
    await store.write(writeRequest({ value: { plan: "v1" } }));
    await store.write(writeRequest({ expectedRevision: 1, value: { plan: "v2" } }));
    await store.write(writeRequest({ namespace: "other", key: "roles", value: ["a"] }));

    const all = await store.list(undefined, undefined);
    expect(all.records.map((record) => [record.namespace, record.key, record.revision])).toEqual([
      ["other", "roles", 1],
      ["palimpsest", "plan", 2],
    ]);

    const filtered = await store.list({ namespace: "palimpsest" }, undefined);
    expect(filtered.records).toHaveLength(1);
    expect(filtered.records[0]).toMatchObject({ key: "plan", revision: 2 });

    const page = await store.list({ limit: 1 }, undefined);
    expect(page.records).toHaveLength(1);
    expect(page.nextCursor).toBeDefined();
    const rest = await store.list({ limit: 1 }, page.nextCursor);
    expect(rest.records).toHaveLength(1);
  });

  it("filters operations by identity scope - budget as a ledger query", async () => {
    const ledger = new MemoryLedger();
    const runtime = new OrdariumRuntime({ ledger });
    const readAction = defineAction({
      name: "state.read",
      version: "1",
      description: "Read",
      input: text,
      output: text,
      effect: effects.readOnly(),
      execute: async (input) => input,
    });
    await runtime.run(readAction, "work", { identity: { ...identity, scope: "scope-a", callId: "call-a1" } });
    await runtime.run(readAction, "work", { identity: { ...identity, scope: "scope-b", callId: "call-b1" } });
    await runtime.run(readAction, "work", { identity: { ...identity, scope: "scope-a", callId: "call-a2" } });

    const scoped = await ledger.list({ scope: "scope-a" });
    expect(scoped.records).toHaveLength(2);
    expect(scoped.records.every((record) => record.identity.scope === "scope-a")).toBe(true);
    expect((await ledger.list({ scope: "scope-b" })).records).toHaveLength(1);
  });
});
