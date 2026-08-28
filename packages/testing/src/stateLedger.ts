import { digestJson, type InvocationIdentity, type JsonValue, type OperationLedger, type OperationRecord, type StateRecord, type StateRef } from "@ordarium/core";

/**
 * State-kind ledger conformance (G11 design spec §7, G11-A09): every ledger
 * claiming `stateRevisions` must reproduce the revision-CAS contract, the
 * append-only history, the reference reverse index and the derived views on
 * the same machinery the operation side uses. Scenarios are
 * framework-agnostic: any violation throws a descriptive Error, so suites in
 * any test runner can drive them against MemoryLedger, SqliteLedger and
 * custom conformant ledgers alike.
 */

const NAMESPACE = "conformance";
const WRITTEN_AT = "2026-01-01T00:00:00.000Z";
const identity: InvocationIdentity = { source: "conformance", scope: "state", callId: "call-1" };

function violation(message: string): Error {
  return new Error(`state ledger conformance violation: ${message}`);
}

function stateRecord(
  revision: number,
  value: JsonValue,
  refs: StateRef[] = [],
  overrides: Partial<StateRecord> = {},
): StateRecord {
  return {
    schemaVersion: 1,
    namespace: NAMESPACE,
    key: "plan",
    revision,
    value,
    valueDigest: digestJson(value),
    refs,
    identity,
    writtenAt: WRITTEN_AT,
    ...overrides,
  };
}

function operationFixture(operationId: string): OperationRecord {
  return {
    schemaVersion: 2,
    operationId,
    actionName: "conformance.operation",
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
    createdAt: WRITTEN_AT,
    updatedAt: WRITTEN_AT,
  };
}

export async function runStateLedgerConformance(ledger: OperationLedger): Promise<void> {
  if (ledger.capabilities.stateRevisions !== true) {
    throw violation("the ledger must declare stateRevisions: true");
  }

  // CAS chain: absent create, duplicate create, stale expectation, mismatched
  // subject coordinates, then the strictly increasing revision chain.
  if (await ledger.getState(NAMESPACE, "plan") !== undefined) {
    throw violation("getState must return undefined for an absent subject");
  }
  if (await ledger.compareAndSetState(NAMESPACE, "plan", 0, stateRecord(1, { v: 1 })) !== true) {
    throw violation("expectedRevision 0 must create the subject");
  }
  if (await ledger.compareAndSetState(NAMESPACE, "plan", 0, stateRecord(1, { v: "again" })) !== false) {
    throw violation("a second expectedRevision 0 write must conflict");
  }
  if (await ledger.compareAndSetState(NAMESPACE, "plan", 5, stateRecord(6, { v: "far" })) !== false) {
    throw violation("a stale expectedRevision must conflict");
  }
  if (await ledger.compareAndSetState(NAMESPACE, "plan", 1, stateRecord(2, { v: 2 }, [], { key: "other" })) !== false) {
    throw violation("a record whose key does not match the CAS coordinates must be rejected");
  }
  if (await ledger.compareAndSetState(NAMESPACE, "plan", 1, stateRecord(2, { v: 2 })) !== true) {
    throw violation("a matching expectedRevision must apply");
  }
  const current = await ledger.getState(NAMESPACE, "plan");
  if (current === undefined || current.revision !== 2 || digestJson(current.value) !== current.valueDigest) {
    throw violation("getState must return the current revision with an honest content digest");
  }

  // History: append-only ascending chain, opaque cursor pagination, absent
  // subject reads as an empty page.
  const firstPage = await ledger.stateHistory(NAMESPACE, "plan", undefined, 1);
  if (firstPage.revisions.length !== 1 || firstPage.revisions[0]?.revision !== 1) {
    throw violation("stateHistory must page the chain in ascending revision order");
  }
  if (firstPage.nextCursor === undefined) {
    throw violation("stateHistory must emit a cursor while more revisions remain");
  }
  const secondPage = await ledger.stateHistory(NAMESPACE, "plan", firstPage.nextCursor, 10);
  if (secondPage.revisions.length !== 1 || secondPage.revisions[0]?.revision !== 2) {
    throw violation("stateHistory must resume from the opaque cursor");
  }
  if (secondPage.nextCursor !== undefined) {
    throw violation("stateHistory must stop emitting cursors at the chain end");
  }
  if ((await ledger.stateHistory(NAMESPACE, "absent", undefined, 10)).revisions.length !== 0) {
    throw violation("stateHistory of an absent subject must be an empty page");
  }

  // References: structural correlation needs an honest reverse index for both
  // ref kinds, with deterministic (namespace, key, revision) ordering.
  const operationId = `op_${"c".repeat(40)}`;
  const created = await ledger.create(operationFixture(operationId));
  if (!created.created) {
    throw violation("the conformance operation fixture must create cleanly");
  }
  const gates = stateRecord(
    1,
    { gates: ["a"] },
    [
      { kind: "operation", id: operationId },
      { kind: "state", id: `${NAMESPACE}/plan@2` },
    ],
    { key: "gates" },
  );
  if (await ledger.compareAndSetState(NAMESPACE, "gates", 0, gates) !== true) {
    throw violation("a subject with resolvable references must create");
  }
  const notes = stateRecord(1, { note: "n" }, [{ kind: "operation", id: operationId }], { key: "notes" });
  if (await ledger.compareAndSetState(NAMESPACE, "notes", 0, notes) !== true) {
    throw violation("the second referencing subject must create");
  }

  const byOperation = await ledger.listStatesReferencing({ kind: "operation", id: operationId }, undefined, 10);
  if (
    byOperation.records.length !== 2 ||
    byOperation.records[0]?.key !== "gates" ||
    byOperation.records[1]?.key !== "notes"
  ) {
    throw violation("listStatesReferencing must return operation-referencing revisions in canonical order");
  }
  const byState = await ledger.listStatesReferencing(
    { kind: "state", id: `${NAMESPACE}/plan@2` },
    undefined,
    10,
  );
  if (byState.records.length !== 1 || byState.records[0]?.key !== "gates") {
    throw violation("listStatesReferencing must resolve state-kind reference ids");
  }
  const refPage = await ledger.listStatesReferencing({ kind: "operation", id: operationId }, undefined, 1);
  if (refPage.records.length !== 1 || refPage.nextCursor === undefined) {
    throw violation("listStatesReferencing must page with a cursor while results remain");
  }
  const refRest = await ledger.listStatesReferencing(
    { kind: "operation", id: operationId },
    refPage.nextCursor,
    10,
  );
  if (refRest.records.length !== 1 || refRest.records[0]?.key !== "notes") {
    throw violation("listStatesReferencing must resume from its cursor");
  }
  if (
    (await ledger.listStatesReferencing({ kind: "operation", id: `op_${"d".repeat(40)}` }, undefined, 10))
      .records.length !== 0
  ) {
    throw violation("listStatesReferencing of an unreferenced object must be empty");
  }

  // Derived view: the current revision per subject, namespace-filterable and
  // cursor-paged in canonical (namespace, key) order.
  const all = await ledger.listStates(undefined, undefined);
  const planKeys = all.records
    .filter((record) => record.namespace === NAMESPACE)
    .map((record) => [record.key, record.revision]);
  if (
    JSON.stringify(planKeys) !== JSON.stringify([["gates", 1], ["notes", 1], ["plan", 2]])
  ) {
    throw violation("listStates must list only the current revision per subject in canonical order");
  }
  if ((await ledger.listStates({ namespace: NAMESPACE }, undefined)).records.length !== 3) {
    throw violation("listStates must honor the namespace filter");
  }
  const subjectPage = await ledger.listStates({ namespace: NAMESPACE, limit: 2 }, undefined);
  if (subjectPage.records.length !== 2 || subjectPage.nextCursor === undefined) {
    throw violation("listStates must page subjects with a cursor");
  }
  const subjectRest = await ledger.listStates({ namespace: NAMESPACE }, subjectPage.nextCursor);
  if (subjectRest.records.length !== 1 || subjectRest.records[0]?.key !== "plan") {
    throw violation("listStates must resume from its cursor");
  }
}
