import { describe, expect, it } from "vitest";

import {
  InvalidCursorError,
  LedgerCapabilityRequiredError,
  MemoryLedger,
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
