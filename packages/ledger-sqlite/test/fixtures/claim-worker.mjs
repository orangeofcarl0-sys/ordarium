import { OrdariumRuntime, defineAction, defineSchema, effects } from "@ordarium/core";
import { SqliteLedger } from "../../dist/src/index.js";

const [dbPath, ownerId] = process.argv.slice(2);

const text = defineSchema({ type: "string" }, (value) => {
  if (typeof value !== "string") throw new TypeError("expected string");
  return value;
});

const action = defineAction({
  name: "g2.process-race",
  version: "1",
  description: "Guarded action raced by two independent processes",
  input: text,
  output: text,
  effect: effects.guarded(),
  async execute(input) {
    // Hold the claim long enough for both processes to be truly concurrent.
    await new Promise((resolve) => setTimeout(resolve, 150));
    return `done:${input}`;
  },
});

const runtime = new OrdariumRuntime({
  ledger: new SqliteLedger(dbPath),
  ownerId,
  allowVolatileLedger: true,
});

try {
  const result = await action.run(runtime, "work", {
    identity: { source: "process", scope: "race", callId: "call-1" },
    authorization: { decision: "allow", kind: "policy-decision", source: "g2-fixture" },
  });
  process.stdout.write(JSON.stringify({ ok: true, result }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, code: error.code ?? String(error) }));
} finally {
  await runtime.close();
}
