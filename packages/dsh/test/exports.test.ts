import * as advanced from "@ordarium/dsh/advanced";
import * as root from "@ordarium/dsh";
import { describe, expect, it } from "vitest";

const curatedRootValues = new Set([
  "defineAction",
  "defineSchema",
  "effects",
  "installOrdarium",
  "jsonValueSchema",
  "schema",
]);

const advancedValues = new Set([
  "asDshTool",
  "createDshOrdarium",
  "createOrdariumPlugin",
  "defaultDatabasePath",
  "registerActions",
]);

const forbiddenAtRoot = [
  "MemoryLedger",
  "OrdariumRuntime",
  "OperationEvent",
  "OperationRecord",
  "SimulatedProcessCrash",
  "SqliteLedger",
  "asDshTool",
  "createDshOrdarium",
  "createOrdariumPlugin",
  "defaultDatabasePath",
  "registerActions",
];

describe("curated DSH façade", () => {
  it("exposes exactly the author golden path at the root entry", () => {
    expect(new Set(Object.keys(root))).toEqual(curatedRootValues);
  });

  it("never re-exports Runtime, Ledger, raw records or advanced bindings from the root", () => {
    const rootKeys = Object.keys(root);
    for (const name of forbiddenAtRoot) {
      expect(rootKeys, `root must not export ${name}`).not.toContain(name);
    }
  });

  it("keeps low-level binding and lifecycle tuning behind /advanced", () => {
    for (const name of advancedValues) {
      expect(advanced, `/advanced must export ${name}`).toHaveProperty(name);
    }
    expect(Object.keys(advanced)).toEqual(expect.arrayContaining([...advancedValues]));
  });
});
