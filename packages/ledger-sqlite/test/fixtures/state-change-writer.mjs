// Independent process writer for the ORD-BOOT-0 change-feed battery.
//   node state-change-writer.mjs <dbPath> <namespace> <key> [mode]
// mode "normal" (default) closes the ledger; "crash" exits without close, so
// the committed WAL transaction must survive an abrupt process teardown.
import { writeSync } from "node:fs";
import { createStateStore } from "@ordarium/core";

import { SqliteLedger } from "../../dist/src/index.js";

const [dbPath, namespace, key, mode] = process.argv.slice(2);

function emit(payload, code) {
  writeSync(1, JSON.stringify(payload));
  process.exit(code);
}

const ledger = new SqliteLedger(dbPath);
const store = createStateStore({ ledger });
let lastError;
for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    const record = await store.write({
      namespace,
      key,
      expectedRevision: 0,
      value: { writer: key },
      identity: { source: "process", scope: "scf", callId: `call-${key}` },
    });
    if (mode === "crash") {
      emit({ ok: true, revision: record.revision }, 0);
    }
    ledger.close();
    emit({ ok: true, revision: record.revision }, 0);
  } catch (error) {
    lastError = error;
    if (error?.code !== "LEDGER_BUSY") break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
emit({ ok: false, code: lastError?.code ?? String(lastError) }, 1);
