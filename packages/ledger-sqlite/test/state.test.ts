import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  digestJson,
  type InvocationIdentity,
  type JsonValue,
  type OperationRecord,
  type StateRecord,
} from "@ordarium/core";
import { runStateLedgerConformance } from "@ordarium/testing";
import { afterEach, describe, expect, it } from "vitest";

import { SqliteLedger } from "../src/index.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createLedger(): SqliteLedger {
  const directory = mkdtempSync(join(tmpdir(), "ordarium-g11-"));
  directories.push(directory);
  return new SqliteLedger(join(directory, "operations.sqlite"));
}

const identity: InvocationIdentity = { source: "test", scope: "state", callId: "call-1" };

function stateRecord(overrides: Partial<StateRecord> = {}): StateRecord {
  const value: JsonValue = overrides.value ?? { plan: "v1" };
  return {
    schemaVersion: 1,
    namespace: "palimpsest",
    key: "plan",
    revision: 1,
    value,
    valueDigest: digestJson(value),
    refs: [],
    identity,
    writtenAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("SqliteLedger state kind (G11)", () => {
  it("passes the state ledger conformance suite (G11-A09)", async () => {
    const ledger = createLedger();
    try {
      await expect(runStateLedgerConformance(ledger)).resolves.toBeUndefined();
    } finally {
      ledger.close();
    }
  });

  it("creates the v3 schema with the state tables and reverse index", () => {
    const ledger = createLedger();
    try {
      const raw = new DatabaseSync(ledger.path);
      const tables = raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => String(row.name));
      expect(tables).toContain("ordarium_state_revisions");
      expect(tables).toContain("ordarium_state_refs");
      expect(raw.prepare("PRAGMA user_version").get()?.user_version).toBe(3);
      raw.close();
    } finally {
      ledger.close();
    }
  });

  it("migrates a v2 database additively and keeps every operation byte identical", async () => {
    const ledger = createLedger();
    const operation: OperationRecord = {
      schemaVersion: 2,
      operationId: `op_${"0123456789abcdef".repeat(3).slice(0, 40)}`,
      actionName: "state.fixture",
      actionVersion: "1",
      inputDigest: "a".repeat(64),
      logicalKeyDigest: "b".repeat(64),
      identity,
      effectKind: "idempotent",
      idempotencyMode: "operation-key",
      state: "proposed",
      semanticRevision: 0,
      attempts: 0,
      lastFencingToken: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    await ledger.create(operation);
    const before = await ledger.get(operation.operationId);
    ledger.close();

    const downgrade = new DatabaseSync(ledger.path);
    downgrade.exec("DROP TABLE ordarium_state_refs");
    downgrade.exec("DROP TABLE ordarium_state_revisions");
    downgrade.exec("PRAGMA user_version = 2");
    downgrade.close();

    const migrated = new SqliteLedger(ledger.path);
    try {
      expect(await migrated.get(operation.operationId)).toEqual(before);
      expect(await migrated.getState("palimpsest", "plan")).toBeUndefined();
      const raw = new DatabaseSync(ledger.path);
      expect(raw.prepare("PRAGMA user_version").get()?.user_version).toBe(3);
      raw.close();
    } finally {
      migrated.close();
    }
  });

  it("creates on revision 0, rejects conflicts, and chains strictly through CAS", async () => {
    const ledger = createLedger();
    try {
      expect(await ledger.compareAndSetState("palimpsest", "plan", 0, stateRecord())).toBe(true);
      expect(await ledger.compareAndSetState("palimpsest", "plan", 0, stateRecord())).toBe(false);
      expect(
        await ledger.compareAndSetState(
          "palimpsest",
          "plan",
          3,
          stateRecord({ revision: 4, value: { plan: "v4" }, valueDigest: digestJson({ plan: "v4" }) }),
        ),
      ).toBe(false);
      expect(
        await ledger.compareAndSetState(
          "palimpsest",
          "plan",
          1,
          stateRecord({ revision: 2, value: { plan: "v2" }, valueDigest: digestJson({ plan: "v2" }) }),
        ),
      ).toBe(true);
      expect(await ledger.getState("palimpsest", "plan")).toMatchObject({
        revision: 2,
        value: { plan: "v2" },
      });
      expect(await ledger.getState("palimpsest", "absent")).toBeUndefined();
    } finally {
      ledger.close();
    }
  });

  it("writes the reference reverse index and reverse-lists deterministically", async () => {
    const ledger = createLedger();
    try {
      await ledger.compareAndSetState(
        "palimpsest",
        "plan",
        0,
        stateRecord({ refs: [{ kind: "operation", id: `op_${"a".repeat(40)}` }] }),
      );
      await ledger.compareAndSetState(
        "palimpsest",
        "plan",
        1,
        stateRecord({
          revision: 2,
          value: { plan: "v2" },
          valueDigest: digestJson({ plan: "v2" }),
          refs: [{ kind: "operation", id: `op_${"a".repeat(40)}` }],
        }),
      );
      await ledger.compareAndSetState(
        "other",
        "plan",
        0,
        stateRecord({
          namespace: "other",
          refs: [{ kind: "operation", id: `op_${"a".repeat(40)}` }],
        }),
      );

      const page = await ledger.listStatesReferencing(
        { kind: "operation", id: `op_${"a".repeat(40)}` },
        undefined,
        2,
      );
      expect(page.records.map((record) => [record.namespace, record.revision])).toEqual([
        ["other", 1],
        ["palimpsest", 1],
      ]);
      expect(page.nextCursor).toBeDefined();

      const rest = await ledger.listStatesReferencing(
        { kind: "operation", id: `op_${"a".repeat(40)}` },
        page.nextCursor,
        10,
      );
      expect(rest.records.map((record) => record.revision)).toEqual([2]);
      expect(rest.nextCursor).toBeUndefined();

      const byState = await ledger.listStatesReferencing(
        { kind: "state", id: "palimpsest/plan@2" },
        undefined,
        10,
      );
      expect(byState.records).toEqual([]);
    } finally {
      ledger.close();
    }
  });

  it("pages the revision history with an opaque cursor", async () => {
    const ledger = createLedger();
    try {
      for (const version of ["v1", "v2", "v3"]) {
        const current = await ledger.getState("palimpsest", "plan");
        await ledger.compareAndSetState(
          "palimpsest",
          "plan",
          current?.revision ?? 0,
          stateRecord({ revision: (current?.revision ?? 0) + 1, value: { plan: version }, valueDigest: digestJson({ plan: version }) }),
        );
      }
      const first = await ledger.stateHistory("palimpsest", "plan", undefined, 2);
      expect(first.revisions.map((record) => record.value)).toEqual([{ plan: "v1" }, { plan: "v2" }]);
      expect(first.nextCursor).toBeDefined();
      const second = await ledger.stateHistory("palimpsest", "plan", first.nextCursor, 2);
      expect(second.revisions.map((record) => record.value)).toEqual([{ plan: "v3" }]);
      expect(await ledger.stateHistory("palimpsest", "absent", undefined, 5)).toMatchObject({
        revisions: [],
      });
    } finally {
      ledger.close();
    }
  });

  it("lists current revisions per subject with namespace filter and cursor paging", async () => {
    const ledger = createLedger();
    try {
      await ledger.compareAndSetState("palimpsest", "plan", 0, stateRecord());
      await ledger.compareAndSetState(
        "palimpsest",
        "plan",
        1,
        stateRecord({ revision: 2, value: { plan: "v2" }, valueDigest: digestJson({ plan: "v2" }) }),
      );
      await ledger.compareAndSetState(
        "other",
        "roles",
        0,
        stateRecord({ namespace: "other", key: "roles" }),
      );

      const all = await ledger.listStates(undefined, undefined);
      expect(all.records.map((record) => [record.namespace, record.key, record.revision])).toEqual([
        ["other", "roles", 1],
        ["palimpsest", "plan", 2],
      ]);

      const filtered = await ledger.listStates({ namespace: "palimpsest" }, undefined);
      expect(filtered.records.map((record) => record.key)).toEqual(["plan"]);

      const page = await ledger.listStates({ limit: 1 }, undefined);
      expect(page.records).toHaveLength(1);
      expect(page.nextCursor).toBeDefined();
      const rest = await ledger.listStates({ limit: 1 }, page.nextCursor);
      expect(rest.records).toHaveLength(1);
    } finally {
      ledger.close();
    }
  });

  it("filters operations by identity scope", async () => {
    const ledger = createLedger();
    try {
      let index = 0;
      for (const scope of ["scope-a", "scope-b", "scope-a"]) {
        index += 1;
        await ledger.create({
          schemaVersion: 2,
          operationId: `op_${digestJson(`${scope}:${index}`).slice(0, 40)}`,
          actionName: "state.fixture",
          actionVersion: "1",
          inputDigest: "a".repeat(64),
          logicalKeyDigest: "b".repeat(64),
          identity: { ...identity, scope, callId: `call-${scope}` },
          effectKind: "idempotent",
          idempotencyMode: "operation-key",
          state: "proposed",
          semanticRevision: 0,
          attempts: 0,
          lastFencingToken: 0,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        });
      }
      const scoped = await ledger.list({ scope: "scope-a" });
      expect(scoped.records).toHaveLength(2);
      expect(scoped.records.every((record) => record.identity.scope === "scope-a")).toBe(true);
      expect((await ledger.list({ scope: "scope-b" })).records).toHaveLength(1);
    } finally {
      ledger.close();
    }
  });
});
