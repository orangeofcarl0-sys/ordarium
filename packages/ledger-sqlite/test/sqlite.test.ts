import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
    const [record] = await secondLedger.list();
    expect(record?.state).toBe("succeeded");
    expect(await secondLedger.history(record!.operationId)).toHaveLength(5);
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
});
