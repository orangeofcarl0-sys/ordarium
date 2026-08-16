import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  OperationBusyError,
  OrdariumRuntime,
  defineAction,
  defineSchema,
  effects,
} from "@ordarium/core";
import { afterEach, describe, expect, it } from "vitest";

import { SqliteLedger } from "../src/index.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SqliteLedger", () => {
  it("declares crash-durable local-multi-process capabilities", () => {
    const directory = mkdtempSync(join(tmpdir(), "ordarium-sqlite-caps-"));
    directories.push(directory);
    const ledger = new SqliteLedger(join(directory, "operations.sqlite"));
    expect(ledger.capabilities).toEqual({
      durability: "crash-durable",
      coordination: "local-multi-process",
      semanticCas: true,
      liveLease: true,
      semanticHistory: true,
    });
    ledger.close();
  });

  it("preserves terminal operations and revision history across reopen", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ordarium-sqlite-"));
    directories.push(directory);
    const path = join(directory, "operations.sqlite");
    let calls = 0;
    const schema = defineSchema<string>({ type: "string" }, (value) => {
      if (typeof value !== "string") throw new TypeError("expected string");
      return value;
    });
    const action = defineAction({
      name: "sqlite.read",
      version: "1",
      description: "Persist one result",
      input: schema,
      output: schema,
      effect: effects.readOnly(),
      execute(value) {
        calls += 1;
        return value.toUpperCase();
      },
    });
    const identity = { source: "test", scope: "sqlite", callId: "one" };

    const firstLedger = new SqliteLedger(path);
    const firstRuntime = new OrdariumRuntime({ ledger: firstLedger });
    await expect(action.run(firstRuntime, "value", { identity })).resolves.toBe("VALUE");
    await firstRuntime.close();

    const secondLedger = new SqliteLedger(path);
    const secondRuntime = new OrdariumRuntime({ ledger: secondLedger });
    await expect(action.run(secondRuntime, "value", { identity })).resolves.toBe("VALUE");
    const [record] = (await secondLedger.list()).records;
    expect(record?.state).toBe("succeeded");
    expect((await secondLedger.history(record!.operationId)).events).toHaveLength(5);
    expect(calls).toBe(1);
    await secondRuntime.close();
  });

  it("arbitrates two runtime owners through SQLite CAS and live lease renewal", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ordarium-sqlite-race-"));
    directories.push(directory);
    const path = join(directory, "operations.sqlite");
    const schema = defineSchema<string>({ type: "string" }, (value) => {
      if (typeof value !== "string") throw new TypeError("expected string");
      return value;
    });
    let calls = 0;
    let started!: () => void;
    const didStart = new Promise<void>((resolve) => {
      started = resolve;
    });
    const action = defineAction({
      name: "sqlite.race",
      version: "1",
      description: "Arbitrate a long operation",
      input: schema,
      output: schema,
      effect: effects.readOnly(),
      async execute(value) {
        calls += 1;
        started();
        await new Promise((resolve) => setTimeout(resolve, 140));
        return value;
      },
    });
    const identity = { source: "test", scope: "sqlite", callId: "race" };
    const first = new OrdariumRuntime({
      ledger: new SqliteLedger(path),
      ownerId: "first",
      leaseMs: 40,
    });
    const second = new OrdariumRuntime({
      ledger: new SqliteLedger(path),
      ownerId: "second",
      leaseMs: 40,
    });

    const running = action.run(first, "held", { identity });
    await didStart;
    await new Promise((resolve) => setTimeout(resolve, 90));
    await expect(action.run(second, "held", { identity }))
      .rejects.toBeInstanceOf(OperationBusyError);
    await expect(running).resolves.toBe("held");
    expect(calls).toBe(1);
    await first.close();
    await second.close();
  });

  it("fails closed when a stored record is corrupt (G1-A06)", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ordarium-sqlite-corrupt-"));
    directories.push(directory);
    const path = join(directory, "operations.sqlite");

    const ledger = new SqliteLedger(path);
    const corrupt = {
      schemaVersion: 2,
      operationId: `op_${"9".repeat(40)}`,
      actionName: "sqlite.corrupt",
      actionVersion: "1",
      inputDigest: "a".repeat(64),
      logicalKeyDigest: "b".repeat(64),
      identity: { source: "test", scope: "sqlite", callId: "bad" },
      effectKind: "guarded",
      idempotencyMode: "none",
      state: "succeeded",
      semanticRevision: 1,
      attempts: 1,
      lastFencingToken: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const raw = new DatabaseSync(path);
    try {
      raw.prepare(`
        INSERT INTO ordarium_operations(operation_id, semantic_revision, state, updated_at, record_json)
        VALUES (?, ?, ?, ?, ?)
      `).run(corrupt.operationId, 1, "succeeded", corrupt.updatedAt, JSON.stringify(corrupt));
    } finally {
      raw.close();
    }
    ledger.close();

    const reopened = new SqliteLedger(path);
    await expect(reopened.get(corrupt.operationId)).rejects.toMatchObject({ code: "LEDGER_CORRUPT" });
    await expect(reopened.list()).rejects.toMatchObject({ code: "LEDGER_CORRUPT" });
    reopened.close();
  });
});
