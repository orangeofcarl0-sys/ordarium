import { describe, expect, it } from "vitest";

import {
  InvalidCursorError,
  LedgerCapabilityRequiredError,
  MemoryLedger,
  RESOURCE_LIMITS,
  createStateStore,
  supportsStateChangeFeed,
  type JsonValue,
  type OrdariumStateStore,
} from "../src/index.js";

const identity = { source: "test", scope: "scf", callId: "call-1" };

function create(store: OrdariumStateStore, namespace: string, key: string, value: JsonValue) {
  return store.write({ namespace, key, expectedRevision: 0, value, identity });
}

function label(entry: { namespace: string; key: string; revision: number }): string {
  return `${entry.namespace}/${entry.key}@${entry.revision}`;
}

describe("ORD-BOOT-0 state change feed (MemoryLedger)", () => {
  it("observes committed revisions in order and paginates with no gaps", async () => {
    const ledger = new MemoryLedger();
    expect(supportsStateChangeFeed(ledger)).toBe(true);
    const store = createStateStore({ ledger });
    await create(store, "alpha", "one", { n: 1 });
    await create(store, "beta", "two", { n: 1 });
    await store.write({ namespace: "alpha", key: "one", expectedRevision: 1, value: { n: 2 }, identity });

    const expected = ["alpha/one@1", "beta/two@1", "alpha/one@2"];
    const seen: string[] = [];
    let cursor: string | undefined = undefined;
    let page = await ledger.changes({ limit: 1 }, cursor);
    seen.push(...page.changes.map(label));
    while (page.hasMore) {
      cursor = page.cursor;
      page = await ledger.changes({ limit: 1 }, cursor);
      seen.push(...page.changes.map(label));
    }
    expect(seen).toEqual(expected);
    expect(new Set(seen).size).toBe(3);
  });

  it("returns a durable caught-up cursor that observes a later revision", async () => {
    const ledger = new MemoryLedger();
    const store = createStateStore({ ledger });
    await create(store, "alpha", "one", { n: 1 });

    const first = await ledger.changes(undefined, undefined);
    expect(first.hasMore).toBe(false);
    const edge = await ledger.changes(undefined, first.cursor);
    expect(edge.changes).toEqual([]);
    expect(edge.hasMore).toBe(false);

    await store.write({ namespace: "alpha", key: "one", expectedRevision: 1, value: { n: 2 }, identity });
    const resumed = await ledger.changes(undefined, edge.cursor);
    expect(resumed.changes.map(label)).toEqual(["alpha/one@2"]);
  });

  it("keeps the feed a projection of the same state truth (refs and identity unchanged)", async () => {
    const ledger = new MemoryLedger();
    const store = createStateStore({ ledger });
    await create(store, "alpha", "one", { n: 1 });
    await store.write({
      namespace: "alpha",
      key: "two",
      expectedRevision: 0,
      value: { n: 1 },
      refs: [{ kind: "state", id: "alpha/one@1" }],
      identity: { source: "test", scope: "scf", callId: "call-2", actor: "writer" },
    });

    const changes = (await ledger.changes(undefined, undefined)).changes;
    expect(changes.map(label)).toEqual(["alpha/one@1", "alpha/two@1"]);
    expect(changes[1]?.refs).toEqual([{ kind: "state", id: "alpha/one@1" }]);
    expect(changes[1]?.identity.actor).toBe("writer");
  });

  it("fails closed on a malformed cursor instead of restarting at zero", async () => {
    const ledger = new MemoryLedger();
    const store = createStateStore({ ledger });
    await create(store, "alpha", "one", { n: 1 });
    const encode = (payload: unknown): string =>
      Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    for (const cursor of [
      "%%%bad%%%",
      encode({ c: "-1" }),
      encode({ c: 1.5 }),
      encode({ c: 12 }),
      encode([1]),
    ]) {
      await expect(ledger.changes(undefined, cursor)).rejects.toBeInstanceOf(InvalidCursorError);
    }
  });

  it("fails the store surface closed when a ledger does not offer the capability", async () => {
    const ledger = new MemoryLedger();
    Object.defineProperty(ledger, "capabilities", {
      value: { ...ledger.capabilities, stateChangeFeed: false },
    });
    expect(supportsStateChangeFeed(ledger)).toBe(false);
    await expect(createStateStore({ ledger }).changes()).rejects.toBeInstanceOf(
      LedgerCapabilityRequiredError,
    );
  });
});

function encodePosition(position: number): string {
  return Buffer.from(JSON.stringify({ c: String(position) }), "utf8").toString("base64url");
}

describe("ORD-BOOT-0.1 page/cursor hardening (MemoryLedger)", () => {
  async function seed(ledger: MemoryLedger, subjects: [string, string][]): Promise<void> {
    const store = createStateStore({ ledger });
    let revision = 0;
    for (const [namespace, key] of subjects) {
      revision += 1;
      await create(store, namespace, key, { revision });
    }
  }

  it("SCF-B01: limit=0 is rejected (no deterministic livelock)", async () => {
    const ledger = new MemoryLedger();
    await seed(ledger, [["alpha", "one"]]);
    await expect(ledger.changes({ limit: 0 }, undefined)).rejects.toBeInstanceOf(TypeError);
  });

  it("SCF-B02: limit=MAX is accepted", async () => {
    const ledger = new MemoryLedger();
    await seed(ledger, [["alpha", "one"]]);
    const page = await ledger.changes(
      { limit: RESOURCE_LIMITS.maxStateChangePageItems },
      undefined,
    );
    expect(page.changes.map(label)).toEqual(["alpha/one@1"]);
  });

  it("SCF-B03: limit=MAX+1 is rejected", async () => {
    const ledger = new MemoryLedger();
    await seed(ledger, [["alpha", "one"]]);
    await expect(
      ledger.changes({ limit: RESOURCE_LIMITS.maxStateChangePageItems + 1 }, undefined),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it("SCF-B04: negative, fractional and unsafe limits are rejected", async () => {
    const ledger = new MemoryLedger();
    await seed(ledger, [["alpha", "one"]]);
    for (const limit of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(ledger.changes({ limit }, undefined)).rejects.toBeInstanceOf(TypeError);
    }
  });

  it("SCF-B05: a future cursor is refused instead of silently starving", async () => {
    const ledger = new MemoryLedger();
    await seed(ledger, [["alpha", "one"], ["alpha", "two"], ["beta", "three"]]);
    await expect(ledger.changes(undefined, encodePosition(4))).rejects.toBeInstanceOf(
      InvalidCursorError,
    );
  });

  it("SCF-B06: on an empty ledger cursor=0 is valid and cursor=1 is refused", async () => {
    const ledger = new MemoryLedger();
    expect((await ledger.changes(undefined, encodePosition(0))).changes).toEqual([]);
    await expect(ledger.changes(undefined, encodePosition(1))).rejects.toBeInstanceOf(
      InvalidCursorError,
    );
  });

  it("SCF-B07: the current high-water is a valid caught-up cursor and observes N+1", async () => {
    const ledger = new MemoryLedger();
    await seed(ledger, [["alpha", "one"], ["alpha", "two"]]);
    const atWater = await ledger.changes(undefined, encodePosition(2));
    expect(atWater.changes).toEqual([]);
    expect(atWater.hasMore).toBe(false);
    await create(createStateStore({ ledger }), "beta", "three", { n: 3 });
    const observed = await ledger.changes(undefined, atWater.cursor);
    expect(observed.changes.map(label)).toEqual(["beta/three@1"]);
  });

  it("SCF-B09: future-cursor validation uses the global high-water, not the namespace max", async () => {
    const ledger = new MemoryLedger();
    await seed(ledger, [
      ["alpha", "a1"],
      ["alpha", "a2"],
      ["alpha", "a3"],
      ["alpha", "a4"],
      ["beta", "b5"],
      ["beta", "b6"],
      ["beta", "b7"],
      ["beta", "b8"],
      ["beta", "b9"],
      ["beta", "b10"],
    ]);
    // Global max = 10, alpha max = 4: reading alpha from cursor 8 is legal.
    const filtered = await ledger.changes({ namespace: "alpha" }, encodePosition(8));
    expect(filtered.changes).toEqual([]);
    await create(createStateStore({ ledger }), "alpha", "a11", { n: 11 });
    const observed = await ledger.changes({ namespace: "alpha" }, encodePosition(8));
    expect(observed.changes.map(label)).toEqual(["alpha/a11@1"]);
  });
});
