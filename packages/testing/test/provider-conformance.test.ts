import {
  IdempotencyExpiredError,
  MemoryLedger,
  OperationConflictError,
  OrdariumRuntime,
  PrincipalConflictError,
  SimulatedProcessCrash,
  UncertainOperationError,
  effects,
  type JsonValue,
  type RuntimeHooks,
} from "@ordarium/core";
import { describe, expect, it } from "vitest";

import {
  HostAdapterHarness,
  ProviderFixture,
  ProviderKeyConflictError,
  ProviderStaleFenceError,
  providerBackedAction,
  providerCapabilityFingerprint,
  providerDeclarations,
  assertEffectSupportedByDeclaration,
} from "../src/index.js";

const allow = { decision: "allow", kind: "policy-decision", source: "conformance" } as const;

function harnessFor(runtime: OrdariumRuntime): HostAdapterHarness {
  return new HostAdapterHarness(runtime, { scope: "conformance" });
}

function suite(fixture: ProviderFixture) {
  const runtime = new OrdariumRuntime({
    ledger: new MemoryLedger(),
    allowVolatileLedger: true,
  });
  return { runtime, harness: harnessFor(runtime), fixture };
}

const keyOf = (input: JsonValue) => `sku:${(input as { sku?: string }).sku}`;

describe("provider capability conformance (G6)", () => {
  it("A01: the same key with the same input reuses one business effect", async () => {
    const fixture = new ProviderFixture({ declaration: providerDeclarations.durableIdempotent() });
    const action = providerBackedAction(fixture, {
      name: "conf.a01",
      effect: effects.idempotent(),
      keyOf,
    });
    const { harness } = suite(fixture);

    const first = await harness.invoke(action, { sku: "a" }, { callId: "c1", authorization: allow });
    const second = await harness.invoke(action, { sku: "a" }, { callId: "c1", authorization: allow });
    expect(second).toEqual(first);
    expect(fixture.calls.execute).toBe(1);
    expect(fixture.effectCount()).toBe(1);
  });

  it("A02: the same key with different input conflicts without a second effect", async () => {
    const fixture = new ProviderFixture({ declaration: providerDeclarations.durableIdempotent() });
    const action = providerBackedAction(fixture, {
      name: "conf.a02",
      effect: effects.idempotent(),
      keyOf,
    });
    const { harness } = suite(fixture);

    await harness.invoke(action, { sku: "a" }, { callId: "c1", authorization: allow });
    await expect(
      harness.invoke(action, { sku: "a", extra: true }, { callId: "c2", authorization: allow }),
    ).rejects.toBeInstanceOf(OperationConflictError);
    await expect(
      fixture.execute("sku:a", { sku: "a", extra: true } as JsonValue),
    ).rejects.toBeInstanceOf(ProviderKeyConflictError);
    expect(fixture.effectCount()).toBe(1);
  });

  it("A03: a lost response after commitment recovers to exactly one effect", async () => {
    const fixture = new ProviderFixture({ declaration: providerDeclarations.durableIdempotent() });
    fixture.loseResponseOnce();
    const action = providerBackedAction(fixture, {
      name: "conf.a03",
      effect: effects.idempotent(),
      keyOf,
    });
    const { harness } = suite(fixture);

    await expect(
      harness.invoke(action, { sku: "a" }, { callId: "c1", authorization: allow }),
    ).rejects.toBeInstanceOf(UncertainOperationError);
    const recovered = await harness.invoke(action, { sku: "a" }, {
      callId: "c1", authorization: allow,
    });
    expect((recovered as { key?: string }).key).toBe("sku:a");
    expect(fixture.calls.execute).toBe(2);
    expect(fixture.effectCount()).toBe(1);
  });

  it("A04/A12: the finite deadline gates retries and is never re-armed", async () => {
    let clockMs = Date.parse("2026-01-01T00:00:00.000Z");
    const clock = () => new Date(clockMs);
    const fixture = new ProviderFixture({ declaration: providerDeclarations.finiteIdempotent() });
    fixture.loseResponseOnce();
    const action = providerBackedAction(fixture, {
      name: "conf.a04",
      effect: effects.idempotent({ window: { kind: "finite", expiresAfterMs: 60_000 } }),
      keyOf,
    });
    const ledger = new MemoryLedger({ clock });
    const crashed = new OrdariumRuntime({
      ledger,
      clock,
      allowVolatileLedger: true,
      hooks: { checkpoint: () => undefined } satisfies RuntimeHooks,
    });
    const harness = new HostAdapterHarness(crashed, { scope: "conformance" });
    await expect(
      harness.invoke(action, { sku: "a" }, { callId: "c1", authorization: allow }),
    ).rejects.toBeInstanceOf(UncertainOperationError);
    const [record] = (await ledger.list()).records;
    const deadline = record?.idempotencyExpiresAt;
    expect(deadline).toBe("2026-01-01T00:01:00.000Z");

    clockMs = Date.parse("2026-01-01T00:00:30.000Z"); // Still inside the window.
    const before = new OrdariumRuntime({ ledger, clock, allowVolatileLedger: true });
    await expect(
      harnessFor(before).invoke(action, { sku: "a" }, { callId: "c1", authorization: allow }),
    ).resolves.toMatchObject({ key: "sku:a" });
    expect(fixture.effectCount()).toBe(1);
    expect((await ledger.list()).records[0]?.idempotencyExpiresAt).toBe(deadline);

    clockMs = Date.parse("2026-01-01T00:02:00.000Z"); // Past sku:a's frozen deadline.
    const crashing = new OrdariumRuntime({
      ledger,
      clock,
      allowVolatileLedger: true,
      hooks: {
        checkpoint: (name) => {
          if (name === "after-dispatch") throw new SimulatedProcessCrash();
        },
      },
    });
    await expect(
      harnessFor(crashing).invoke(action, { sku: "b" }, { callId: "c2", authorization: allow }),
    ).rejects.toMatchObject({ code: "SIMULATED_PROCESS_CRASH" });
    const executeBeforeExpiry = fixture.calls.execute; // sku:b never reached the provider.

    clockMs = Date.parse("2026-01-01T00:03:30.000Z"); // sku:b's own deadline (00:03) has passed.
    const second = new OrdariumRuntime({ ledger, clock, allowVolatileLedger: true });
    await expect(
      harnessFor(second).invoke(action, { sku: "b" }, { callId: "c2", authorization: allow }),
    ).rejects.toBeInstanceOf(IdempotencyExpiredError);
    const executeAfterExpiry = fixture.calls.execute;
    await expect(
      harnessFor(second).invoke(action, { sku: "b" }, { callId: "c2", authorization: allow }),
    ).rejects.toBeInstanceOf(IdempotencyExpiredError);
    expect(fixture.calls.execute).toBe(executeAfterExpiry); // No execute past the deadline.
    expect(fixture.calls.execute).toBe(executeBeforeExpiry);
    const skuB = (await ledger.list()).records.find((record) => record.identity.callId === "c2");
    expect(skuB?.state).toBe("uncertain");
    expect(skuB?.idempotencyExpiresAt).toBe("2026-01-01T00:03:00.000Z");
  });

  it("A05: a pending query settles only on the terminal provider fact", async () => {
    const fixture = new ProviderFixture({ declaration: providerDeclarations.reconcilable() });
    fixture.loseResponseOnce();
    const action = providerBackedAction(fixture, {
      name: "conf.a05",
      effect: effects.reconcilable(),
      keyOf,
    });
    const { harness } = suite(fixture);

    await expect(
      harness.invoke(action, { sku: "a" }, { callId: "c1", authorization: allow }),
    ).rejects.toBeInstanceOf(UncertainOperationError);
    fixture.pendingOnce();
    await expect(
      harness.invoke(action, { sku: "a" }, { callId: "c1", authorization: allow }),
    ).rejects.toBeInstanceOf(UncertainOperationError);
    const settled = await harness.invoke(action, { sku: "a" }, { callId: "c1", authorization: allow });
    expect((settled as { key?: string }).key).toBe("sku:a");
    expect(fixture.calls.query).toBe(2);
    expect(fixture.effectCount()).toBe(1);
  });

  it("A06: an eventual false absence never licenses a redispatch", async () => {
    const fixture = new ProviderFixture({ declaration: providerDeclarations.falseAbsence() });
    fixture.loseResponseOnce();
    const action = providerBackedAction(fixture, {
      name: "conf.a06",
      effect: effects.reconcilable(),
      keyOf,
    });
    const { harness } = suite(fixture);

    await expect(
      harness.invoke(action, { sku: "a" }, { callId: "c1", authorization: allow }),
    ).rejects.toBeInstanceOf(UncertainOperationError);
    fixture.eventualAbsenceOnce();
    await expect(
      harness.invoke(action, { sku: "a" }, { callId: "c1", authorization: allow }),
    ).rejects.toBeInstanceOf(UncertainOperationError);
    const executeAfterFalseAbsent = fixture.calls.execute;
    // Eventual consistency converges on the real fact without any redispatch.
    await expect(
      harness.invoke(action, { sku: "a" }, { callId: "c1", authorization: allow }),
    ).resolves.toMatchObject({ key: "sku:a" });
    expect(fixture.calls.execute).toBe(executeAfterFalseAbsent);
    expect(fixture.effectCount()).toBe(1);
  });

  it("A07: authoritative absence redispatches in normal mode only", async () => {
    const crashAfterDurableDispatch = (): RuntimeHooks => ({
      checkpoint: (name) => {
        if (name === "after-dispatch") throw new SimulatedProcessCrash();
      },
    });

    // The effect was never committed: the provider fact is an authoritative absence.
    const normal = new ProviderFixture({ declaration: providerDeclarations.reconcilable() });
    const normalAction = providerBackedAction(normal, {
      name: "conf.a07a",
      effect: effects.reconcilable(),
      keyOf,
    });
    const normalClockMs = { value: Date.parse("2026-01-01T00:00:00.000Z") };
    const normalClock = () => new Date(normalClockMs.value);
    const normalLedger = new MemoryLedger({ clock: normalClock });
    const normalRuntime = new OrdariumRuntime({
      ledger: normalLedger,
      clock: normalClock,
      leaseMs: 50,
      allowVolatileLedger: true,
      hooks: crashAfterDurableDispatch(),
    });
    await expect(
      harnessFor(normalRuntime).invoke(normalAction, { sku: "a" }, { callId: "c1", authorization: allow }),
    ).rejects.toMatchObject({ code: "SIMULATED_PROCESS_CRASH" });
    await normalRuntime.dispose();
    normalClockMs.value += 500; // Let the crashed owner's lease expire.
    const normalRecovery = new OrdariumRuntime({
      ledger: normalLedger, clock: normalClock, leaseMs: 50, allowVolatileLedger: true,
    });
    await expect(
      harnessFor(normalRecovery).invoke(normalAction, { sku: "a" }, { callId: "c1", authorization: allow }),
    ).resolves.toMatchObject({ key: "sku:a" });
    expect(normal.calls.execute).toBe(1);
    expect(normal.effectCount()).toBe(1);

    const queryOnly = new ProviderFixture({ declaration: providerDeclarations.reconcilable() });
    const queryOnlyAction = providerBackedAction(queryOnly, {
      name: "conf.a07b",
      effect: effects.reconcilable(),
      keyOf,
    });
    const queryOnlyClockMs = { value: Date.parse("2026-01-01T00:00:00.000Z") };
    const queryOnlyClock = () => new Date(queryOnlyClockMs.value);
    const queryOnlyLedger = new MemoryLedger({ clock: queryOnlyClock });
    const queryOnlyRuntime = new OrdariumRuntime({
      ledger: queryOnlyLedger,
      clock: queryOnlyClock,
      leaseMs: 50,
      allowVolatileLedger: true,
      hooks: crashAfterDurableDispatch(),
    });
    await expect(
      harnessFor(queryOnlyRuntime).invoke(queryOnlyAction, { sku: "b" }, { callId: "c1", authorization: allow }),
    ).rejects.toMatchObject({ code: "SIMULATED_PROCESS_CRASH" });
    await queryOnlyRuntime.dispose();
    queryOnlyClockMs.value += 500;
    const queryOnlyRecovery = new OrdariumRuntime({
      ledger: queryOnlyLedger, clock: queryOnlyClock, leaseMs: 50, allowVolatileLedger: true,
    });
    await expect(
      queryOnlyRecovery.reconcileOnly(queryOnlyAction, { sku: "b" }, {
        identity: { source: "harness", scope: "conformance", callId: "c1" },
      }),
    ).rejects.toBeInstanceOf(UncertainOperationError);
    expect(queryOnly.calls.execute).toBe(0); // The spy stayed at zero.
  });

  it("A08: an accepted cancel settles on the queried fact, never on cancelled", async () => {
    const fixture = new ProviderFixture({ declaration: providerDeclarations.cancellable() });
    fixture.loseResponseOnce();
    const action = providerBackedAction(fixture, {
      name: "conf.a08",
      effect: effects.reconcilable({ cancellable: true }),
      keyOf,
    });
    const { harness, runtime } = suite(fixture);

    await expect(
      harness.invoke(action, { sku: "a" }, { callId: "c1", authorization: allow }),
    ).rejects.toBeInstanceOf(UncertainOperationError);
    await expect(fixture.cancel("sku:a")).resolves.toBe("accepted");
    expect(fixture.calls.cancel).toBe(1);

    const settled = await harness.invoke(action, { sku: "a" }, { callId: "c1", authorization: allow });
    expect((settled as { key?: string }).key).toBe("sku:a");
    const [record] = (await runtime.ledger.list()).records;
    expect(record?.state).toBe("reconciled");
    expect(record?.reconciliation?.outcome).toBe("succeeded");
  });

  it("A09: a fenced provider rejects stale tokens while the effect stays single", async () => {
    const fixture = new ProviderFixture({ declaration: providerDeclarations.fenced() });
    const action = providerBackedAction(fixture, {
      name: "conf.a09",
      effect: effects.reconcilable({ idempotencyWindow: { kind: "durable" } }),
      keyOf,
    });

    const { harness } = suite(fixture);
    const recovered = await harness.invoke(action, { sku: "a" }, { callId: "c1", authorization: allow });
    expect((recovered as { key?: string }).key).toBe("sku:a");

    // A takeover fence (2) is accepted; the revived old fence (1) is rejected
    // while the business effect stays single.
    await expect(fixture.execute("sku:a", { sku: "a" }, 2)).resolves.toBeTruthy();
    await expect(fixture.execute("sku:a", { sku: "a" }, 1))
      .rejects.toBeInstanceOf(ProviderStaleFenceError);
    expect(fixture.effectCount()).toBe(1);
  });

  it("A10: a changed provider principal cannot continue the original operation", async () => {
    const fixture = new ProviderFixture({ declaration: providerDeclarations.durableIdempotent() });
    const action = providerBackedAction(fixture, {
      name: "conf.a10",
      effect: effects.idempotent(),
      keyOf,
    });
    const { harness } = suite(fixture);
    const accountA = { namespace: "tenant-1", subject: "user-a" };
    const accountB = { namespace: "tenant-1", subject: "user-b" };

    await harness.invoke(action, { sku: "a" }, {
      callId: "c1", authorization: allow, providerPrincipalRef: accountA,
    });
    await expect(
      harness.invoke(action, { sku: "a" }, {
        callId: "c1", authorization: allow, providerPrincipalRef: accountB,
      }),
    ).rejects.toBeInstanceOf(PrincipalConflictError);
    expect(fixture.effectCount()).toBe(1);
  });

  it("A11: unsupported profile/declaration pairings are rejected before wiring", () => {
    const opaque = providerDeclarations.opaque();
    expect(() => assertEffectSupportedByDeclaration(effects.idempotent(), opaque)).toThrow(/guarded/u);
    expect(() => assertEffectSupportedByDeclaration(effects.reconcilable(), opaque)).toThrow(/query/u);
    expect(() =>
      assertEffectSupportedByDeclaration(
        effects.reconcilable({ cancellable: true }),
        providerDeclarations.reconcilable(),
      ),
    ).toThrow(/cancellation/u);
    expect(() => assertEffectSupportedByDeclaration(effects.guarded(), opaque)).not.toThrow();
    expect(() =>
      assertEffectSupportedByDeclaration(
        effects.idempotent({ window: { kind: "finite", expiresAfterMs: 1_000 } }),
        providerDeclarations.finiteIdempotent(),
      ),
    ).not.toThrow();

    const fingerprint = providerCapabilityFingerprint(providerDeclarations.durableIdempotent());
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(fingerprint).toBe(providerCapabilityFingerprint(providerDeclarations.durableIdempotent()));
  });

  it("A12: restarts never extend a finite deadline (persistent value asserted)", async () => {
    let clockMs = Date.parse("2026-01-01T00:00:00.000Z");
    const clock = () => new Date(clockMs);
    const fixture = new ProviderFixture({ declaration: providerDeclarations.finiteIdempotent() });
    fixture.loseResponseOnce();
    const action = providerBackedAction(fixture, {
      name: "conf.a12",
      effect: effects.idempotent({ window: { kind: "finite", expiresAfterMs: 30_000 } }),
      keyOf,
    });
    const ledger = new MemoryLedger({ clock });
    const first = new OrdariumRuntime({ ledger, clock, allowVolatileLedger: true });
    await expect(
      harnessFor(first).invoke(action, { sku: "a" }, { callId: "c1", authorization: allow }),
    ).rejects.toBeInstanceOf(UncertainOperationError);
    await first.dispose();

    clockMs = Date.parse("2026-01-01T00:00:20.000Z");
    const second = new OrdariumRuntime({ ledger, clock, allowVolatileLedger: true });
    await expect(
      harnessFor(second).invoke(action, { sku: "a" }, { callId: "c1", authorization: allow }),
    ).resolves.toBeTruthy();
    const deadline = (await ledger.list()).records[0]?.idempotencyExpiresAt;
    expect(deadline).toBe("2026-01-01T00:00:30.000Z");

    clockMs = Date.parse("2026-01-01T00:00:40.000Z");
    const third = new OrdariumRuntime({ ledger, clock, allowVolatileLedger: true });
    // Re-opening the terminal operation replays its result; the deadline
    // field itself never moved.
    await expect(
      harnessFor(third).invoke(action, { sku: "a" }, { callId: "c1", authorization: allow }),
    ).resolves.toBeTruthy();
    expect((await ledger.list()).records[0]?.idempotencyExpiresAt).toBe(deadline);
  });

  it("keeps the opaque profile honest: no recovery primitive means honest uncertain", async () => {
    const fixture = new ProviderFixture({ declaration: providerDeclarations.opaque() });
    fixture.loseResponseOnce();
    const action = providerBackedAction(fixture, {
      name: "conf.opaque",
      effect: effects.guarded(),
      keyOf,
    });
    const { harness } = suite(fixture);

    await expect(
      harness.invoke(action, { sku: "a" }, { callId: "c1", authorization: allow }),
    ).rejects.toBeInstanceOf(UncertainOperationError);
    const executeCount = fixture.calls.execute;
    await expect(
      harness.invoke(action, { sku: "a" }, { callId: "c1", authorization: allow }),
    ).rejects.toBeInstanceOf(UncertainOperationError);
    expect(fixture.calls.execute).toBe(executeCount); // No blind retry.
    await expect(fixture.query("sku:a")).rejects.toThrow(/query primitive/u);
    void SimulatedProcessCrash;
  });
});
