import { OrdariumRuntime, defineAction, defineSchema, effects } from "@ordarium/core";
import { SqliteLedger } from "@ordarium/ledger-sqlite";

import { createMcpOrdarium } from "../../dist/src/index.js";

const dbPath = process.argv[2];

const reserveInput = defineSchema(
  {
    type: "object",
    properties: { sku: { type: "string" } },
    required: ["sku"],
    additionalProperties: false,
  },
  (value) => {
    if (value === null || typeof value !== "object" || typeof value.sku !== "string") {
      throw new TypeError("expected { sku: string }");
    }
    return value;
  },
);
const echoInput = defineSchema(
  {
    type: "object",
    properties: { value: { type: "string" } },
    required: ["value"],
    additionalProperties: false,
  },
  (value) => {
    if (value === null || typeof value !== "object" || typeof value.value !== "string") {
      throw new TypeError("expected { value: string }");
    }
    return value;
  },
);
const outputSchema = defineSchema({ type: "string" }, (value) => {
  if (typeof value !== "string") throw new TypeError("expected string");
  return value;
});

const actions = [
  {
    name: "demo.reserve-sku",
    version: "1",
    description: "Reserve one SKU exactly once across hosts",
    input: reserveInput,
    output: outputSchema,
    effect: effects.guarded(),
    key: (input) => `sku:${input.sku}`,
    execute: (input) => `reserved:${input.sku}`,
  },
  {
    name: "demo.echo",
    version: "1",
    description: "Echo the provided value",
    input: echoInput,
    output: outputSchema,
    effect: effects.guarded(),
    execute: (input) => input.value,
  },
  {
    name: "demo.fail",
    version: "1",
    description: "Always fails",
    input: echoInput,
    output: outputSchema,
    effect: effects.guarded(),
    execute: () => {
      throw new Error("provider exploded");
    },
  },
].map((definition) => defineAction(definition));

const runtime = new OrdariumRuntime({
  ledger: new SqliteLedger(dbPath),
  deploymentCoordination: "local-multi-process",
});

const server = createMcpOrdarium({
  runtime,
  actions,
  authorize: () => ({
    decision: "allow",
    kind: "policy-decision",
    source: "g5-fixture:policy",
  }),
});

await server.start();
