import { randomUUID } from "node:crypto";

import type {
  Action,
  ActionExecutionContext,
  ActionRunOptions,
  ActionRunner,
  ReconcileResult,
} from "./action.js";
import { contractFingerprint } from "./action.js";
import {
  ActionDeniedError,
  AuthorizationConflictError,
  AuthorizationRequiredError,
  ContractDriftError,
  IdempotencyExpiredError,
  IdentityRequiredError,
  InputTooLargeError,
  LedgerCapabilityRequiredError,
  OperationBusyError,
  OperationCancelledError,
  OperationConflictError,
  OperationFailedError,
  PersistedValueTooLargeError,
  PrincipalConflictError,
  RuntimeClosedError,
  RuntimeQuiescingError,
  SimulatedProcessCrash,
  UncertainOperationError,
} from "./errors.js";
import { RESOURCE_LIMITS } from "./codec.js";
import {
  hasExternalSideEffect,
  requiresAuthorization,
  usesOperationKey,
} from "./effects.js";
import { assertJsonValue, canonicalJson, digestJson, type JsonValue } from "./json.js";
import { MemoryLedger } from "./ledger.js";
import {
  evaluateAuthoritativeAbsence,
  evaluateRecovery,
  idempotencyDeadlinePassed,
} from "./recovery.js";
import type { HostInvocation, HostInvocationPort } from "./host.js";
import type {
  AuthorizationDecision,
  AuthorizationEvidenceKind,
  InvocationIdentity,
  LedgerCoordination,
  OperationLedger,
  OperationRecord,
  ProviderPrincipalRef,
  SafeError,
} from "./types.js";

const COORDINATION_COVERAGE: Record<LedgerCoordination, number> = {
  "single-isolate": 0,
  "single-process-exclusive": 1,
  "local-multi-process": 2,
};

export type RuntimeCheckpoint = "after-claim" | "after-dispatch" | "after-reconcile";

export interface RuntimeHooks {
  checkpoint?(name: RuntimeCheckpoint, record: OperationRecord): Promise<void> | void;
}

export interface AuthorizationRequest {
  action: {
    name: string;
    version: string;
    description: string;
    guarantee: string;
  };
  input: JsonValue;
  identity: InvocationIdentity;
  operationId: string;
}

export type Authorizer = (
  request: AuthorizationRequest,
) => Promise<AuthorizationDecision> | AuthorizationDecision;

export interface OrdariumRuntimeOptions {
  ledger?: OperationLedger | undefined;
  authorizer?: Authorizer | undefined;
  ownerId?: string | undefined;
  leaseMs?: number | undefined;
  clock?: (() => Date) | undefined;
  hooks?: RuntimeHooks | undefined;
  maxPersistedJsonBytes?: number | undefined;
  /**
   * Deployment topology the installation declares (docs/13 §6.1). Defaults
   * to "single-isolate" for direct core embedding; the managed DSH path
   * declares "local-multi-process".
   */
  deploymentCoordination?: LedgerCoordination | undefined;
  /**
   * Explicit weak-mode opt-in for tests and embedded deployments that
   * knowingly run managed writes on a volatile ledger. No crash or restart
   * guarantee is provided; production managed writes must fail closed
   * instead (G1-A10).
   */
  allowVolatileLedger?: boolean | undefined;
}

interface InFlight {
  inputDigest: string;
  operationId: string;
  controller: AbortController;
  promise: Promise<unknown>;
}

export type RuntimeLifecycleState =
  | "accepting"
  | "quiescing"
  | "draining"
  | "closing"
  | "closed";

type LeaseWorkResult<T> =
  | { status: "fulfilled"; value: T; leaseLost: boolean }
  | { status: "rejected"; error: unknown; leaseLost: boolean };

export class OrdariumRuntime implements ActionRunner, HostInvocationPort {
  readonly ledger: OperationLedger;
  readonly #authorizer?: Authorizer | undefined;
  readonly #ownerId: string;
  readonly #leaseMs: number;
  readonly #clock: () => Date;
  readonly #hooks?: RuntimeHooks | undefined;
  readonly #maxPersistedJsonBytes: number;
  readonly #deploymentCoordination: LedgerCoordination;
  readonly #allowVolatileLedger: boolean;
  readonly #inFlight = new Map<string, InFlight>();
  #lifecycle: RuntimeLifecycleState = "accepting";

  constructor(options: OrdariumRuntimeOptions = {}) {
    this.#clock = options.clock ?? (() => new Date());
    this.ledger = options.ledger ?? new MemoryLedger({ clock: this.#clock });
    this.#authorizer = options.authorizer;
    this.#ownerId = options.ownerId ?? `runtime-${randomUUID()}`;
    this.#leaseMs = Math.max(1, options.leaseMs ?? 30_000);
    this.#hooks = options.hooks;
    this.#maxPersistedJsonBytes = options.maxPersistedJsonBytes ?? 1_048_576;
    this.#deploymentCoordination = options.deploymentCoordination ?? "single-isolate";
    this.#allowVolatileLedger = options.allowVolatileLedger ?? false;
    if (!Number.isSafeInteger(this.#maxPersistedJsonBytes) || this.#maxPersistedJsonBytes <= 0) {
      throw new TypeError("maxPersistedJsonBytes must be a positive safe integer");
    }
  }

  /** Current lifecycle position (G3 spec §1); transitions are monotonic. */
  get lifecycle(): RuntimeLifecycleState {
    return this.#lifecycle;
  }

  /**
   * Stop accepting new invocations. New runs fail closed with
   * RUNTIME_QUIESCING; in-flight work is untouched until dispose().
   */
  async quiesce(): Promise<void> {
    if (this.#lifecycle === "accepting") {
      this.#lifecycle = "quiescing";
    }
  }

  /**
   * The one disposal path (G3 spec §2): quiesce -> bounded drain -> abort
   * remaining -> durable handoff -> absorb late callbacks -> close ledger.
   * The old unregister-then-close shortcut no longer exists.
   */
  async dispose(options: { drainMs?: number | undefined } = {}): Promise<void> {
    await this.quiesce();
    if (this.#lifecycle === "closed") return;

    this.#lifecycle = "draining";
    const drainMs = Math.max(0, options.drainMs ?? this.#leaseMs);
    await this.#settleInFlight(drainMs);

    for (const entry of [...this.#inFlight.values()]) {
      entry.controller.abort(new Error("Ordarium runtime disposal aborted remaining work"));
    }
    await this.#settleInFlight(Math.min(drainMs, 250));
    for (const entry of [...this.#inFlight.values()]) {
      await this.#handoff(entry);
      // Absorb late callbacks: a hung action that eventually settles after
      // close must not surface as an unhandled rejection.
      void entry.promise.catch(() => undefined);
    }

    this.#lifecycle = "closing";
    await this.ledger.close?.();
    this.#lifecycle = "closed";
  }

  async close(): Promise<void> {
    await this.dispose();
  }

  async #settleInFlight(timeoutMs: number): Promise<void> {
    const pending = [...this.#inFlight.values()].map((entry) => entry.promise);
    if (pending.length === 0) return;
    await Promise.race([
      Promise.allSettled(pending),
      new Promise((resolve) => {
        const timer = setTimeout(resolve, timeoutMs);
        timer.unref?.();
      }),
    ]);
  }

  /**
   * Durable handoff for work still in flight at the drain deadline: writes
   * the honest recoverable state without waiting for the hung action -
   * cancelled before any dispatch, uncertain after a possible dispatch.
   * A concurrent terminal write wins and the handoff becomes a no-op.
   */
  async #handoff(entry: InFlight): Promise<void> {
    if (!this.#inFlight.has(entry.operationId)) return;
    try {
      const record = await this.ledger.get(entry.operationId);
      if (record === undefined) return;
      if (record.state === "proposed" || record.state === "authorized") {
        await this.#update(record, { state: "cancelled", claim: undefined });
        return;
      }
      if (record.state === "claimed" || record.state === "dispatched") {
        await this.#markUncertain(record, "runtime-dispose-handoff");
      }
    } catch {
      // The ledger may already be closing or the action raced a terminal
      // write; either way the durable record decides the truth.
    }
  }

  async run<I extends JsonValue, O extends JsonValue>(
    action: Action<I, O>,
    unknownInput: unknown,
    options: ActionRunOptions = {},
  ): Promise<O> {
    if (this.#lifecycle === "closing" || this.#lifecycle === "closed") {
      throw new RuntimeClosedError();
    }
    if (this.#lifecycle !== "accepting") {
      throw new RuntimeQuiescingError();
    }
    const input = action.input.parse(unknownInput);
    assertJsonValue(input, "action input");
    const inputBytes = Buffer.byteLength(canonicalJson(input), "utf8");
    if (inputBytes > RESOURCE_LIMITS.maxInputJsonBytes) {
      throw new InputTooLargeError(RESOURCE_LIMITS.maxInputJsonBytes);
    }
    this.#assertLedgerEligibility(action);
    const identity = options.identity ?? directIdentity(action);
    assertInvocationIdentity(identity);
    if (options.providerPrincipalRef !== undefined) {
      assertProviderPrincipalRef(options.providerPrincipalRef);
    }
    const logicalKey = action.key?.(input, identity) ??
      `${identity.source}\u0000${identity.scope}\u0000${identity.callId}`;
    if (logicalKey.length === 0) throw new TypeError("Action logical key must not be empty");
    const logicalKeyDigest = digestJson(logicalKey);
    const operationId = `op_${digestJson({
      action: action.name,
      version: action.version,
      logicalKeyDigest,
    }).slice(0, 40)}`;
    const inputDigest = digestJson(input);

    const active = this.#inFlight.get(operationId);
    if (active !== undefined) {
      if (active.inputDigest !== inputDigest) {
        throw new OperationConflictError(operationId);
      }
      return action.output.parse(await active.promise);
    }

    const controller = new AbortController();
    const runOptions: ActionRunOptions = options.signal === undefined
      ? { ...options, signal: controller.signal }
      : { ...options, signal: AbortSignal.any([options.signal, controller.signal]) };
    const promise = this.#runInternal(
      action,
      input,
      identity,
      operationId,
      logicalKeyDigest,
      inputDigest,
      runOptions,
    );
    this.#inFlight.set(operationId, { inputDigest, operationId, controller, promise });
    try {
      return action.output.parse(await promise);
    } finally {
      if (this.#inFlight.get(operationId)?.promise === promise) {
        this.#inFlight.delete(operationId);
      }
    }
  }

  async invoke<I extends JsonValue, O extends JsonValue>(
    action: Action<I, O>,
    input: unknown,
    invocation: HostInvocation,
  ): Promise<O> {
    return this.run(action, input, invocation);
  }

  async #runInternal<I extends JsonValue, O extends JsonValue>(
    action: Action<I, O>,
    input: I,
    identity: InvocationIdentity,
    operationId: string,
    logicalKeyDigest: string,
    inputDigest: string,
    options: ActionRunOptions,
  ): Promise<O> {
    const now = this.#now();
    const principalDigest = options.providerPrincipalRef === undefined
      ? undefined
      : principalDigestOf(options.providerPrincipalRef);
    const created = await this.ledger.create({
      schemaVersion: 2,
      operationId,
      actionName: action.name,
      actionVersion: action.version,
      contractFingerprint: contractFingerprint(action),
      inputDigest,
      logicalKeyDigest,
      providerPrincipalDigest: principalDigest,
      identity,
      effectKind: action.effect.kind,
      idempotencyMode: usesOperationKey(action.effect) ? "operation-key" : "none",
      idempotencyExpiresAt: idempotencyDeadlineOf(action, this.#clock),
      state: "proposed",
      semanticRevision: 0,
      attempts: 0,
      lastFencingToken: 0,
      createdAt: now,
      updatedAt: now,
    });
    let record = created.record;
    this.#assertCompatible(record, action, inputDigest, logicalKeyDigest);
    this.#assertAuthorizationConsistent(record, options);
    record = await this.#applyContractBinding(record, action);
    record = await this.#applyPrincipalBinding(record, options);

    while (true) {
      const terminal = this.#readTerminal(record, action);
      if (terminal.done) {
        return terminal.value;
      }

      if (record.state === "proposed") {
        const decision = await this.#authorize(action, input, identity, operationId, options);
        assertAuthorizationDecision(decision);
        const next = await this.#update(record, {
          state: decision.decision === "allow" ? "authorized" : "denied",
          authorization: { ...decision, at: this.#now() },
        });
        if (next === undefined) {
          record = await this.#reload(operationId);
          continue;
        }
        record = next;
        if (decision.decision === "deny") {
          throw new ActionDeniedError(operationId);
        }
        continue;
      }

      if (record.state === "authorized") {
        if (options.signal?.aborted === true) {
          const cancelled = await this.#update(record, {
            state: "cancelled",
            claim: undefined,
          });
          if (cancelled === undefined) {
            record = await this.#reload(operationId);
            continue;
          }
          throw new OperationCancelledError(operationId);
        }
        const claimed = await this.#claim(record, "authorized");
        if (claimed === undefined) {
          record = await this.#reload(operationId);
          continue;
        }
        record = claimed;
        await this.#hooks?.checkpoint?.("after-claim", record);
        continue;
      }

      if (record.state === "dispatched" || record.state === "uncertain") {
        const recoveryState = record.state;
        const claimed = await this.#claim(record, recoveryState);
        if (claimed === undefined) {
          record = await this.#reload(operationId);
          continue;
        }
        record = claimed;
        await this.#hooks?.checkpoint?.("after-claim", record);
        continue;
      }

      if (record.state === "claimed") {
        const resumeFrom = record.claim?.resumeFrom ?? "uncertain";
        if (resumeFrom === "authorized") {
          return this.#dispatchAndExecute(action, input, record, options.signal);
        }
        return this.#recover(action, input, record, options.signal);
      }

      throw new OperationFailedError(operationId, `Unsupported operation state: ${record.state}`);
    }
  }

  async #authorize<I extends JsonValue, O extends JsonValue>(
    action: Action<I, O>,
    input: I,
    identity: InvocationIdentity,
    operationId: string,
    options: ActionRunOptions,
  ): Promise<AuthorizationDecision> {
    if (options.authorization !== undefined) {
      return options.authorization;
    }
    if (!requiresAuthorization(action.effect)) {
      return {
        decision: "allow",
        kind: "host-admission",
        source: `implicit:${action.effect.kind}`,
      };
    }
    if (this.#authorizer === undefined) {
      throw new AuthorizationRequiredError(operationId);
    }
    return this.#authorizer({
      action: {
        name: action.name,
        version: action.version,
        description: action.description,
        guarantee: action.effect.kind,
      },
      input,
      identity,
      operationId,
    });
  }

  /**
   * Semantic claim with atomic lease creation (G2 design spec §2). A live
   * foreign lease makes the operation busy; an expired lease may be taken
   * over with a monotonically higher fencing token.
   */
  async #claim(
    record: OperationRecord,
    resumeFrom: "authorized" | "dispatched" | "uncertain",
  ): Promise<OperationRecord | undefined> {
    const activeLease = await this.ledger.lease(record.operationId);
    if (
      activeLease !== undefined &&
      activeLease.owner !== this.#ownerId &&
      Date.parse(activeLease.expiresAt) > this.#clock().getTime()
    ) {
      throw new OperationBusyError(record.operationId);
    }
    const fencingToken = record.lastFencingToken + 1;
    const acquiredAt = this.#now();
    const claimed = await this.ledger.claim(
      record.operationId,
      record.semanticRevision,
      {
        owner: this.#ownerId,
        fencingToken,
        acquiredAt,
        resumeFrom,
      },
      {
        owner: this.#ownerId,
        fencingToken,
        expiresAt: new Date(this.#clock().getTime() + this.#leaseMs).toISOString(),
      },
    );
    return claimed ? await this.#reload(record.operationId) : undefined;
  }

  async #dispatchAndExecute<I extends JsonValue, O extends JsonValue>(
    action: Action<I, O>,
    input: I,
    claimed: OperationRecord,
    signal?: AbortSignal,
  ): Promise<O> {
    const effectiveSignal = signal ?? new AbortController().signal;
    if (effectiveSignal.aborted) {
      const state = claimed.claim?.resumeFrom === "authorized" ? "cancelled" : "uncertain";
      const next = await this.#update(claimed, {
        state,
        claim: undefined,
        uncertainty: state === "uncertain"
          ? { reason: "cancelled-after-possible-dispatch", at: this.#now() }
          : undefined,
      });
      if (next === undefined) throw new OperationBusyError(claimed.operationId);
      if (state === "cancelled") throw new OperationCancelledError(claimed.operationId);
      throw new UncertainOperationError(claimed.operationId);
    }

    const dispatched = await this.#update(claimed, {
      state: "dispatched",
      attempts: claimed.attempts + 1,
      claim: claimed.claim === undefined
        ? undefined
        : { ...claimed.claim, resumeFrom: undefined },
      uncertainty: undefined,
    });
    if (dispatched === undefined) throw new OperationBusyError(claimed.operationId);

    // A frozen finite deadline gates every execution attempt, including the
    // first (G3 spec §4): past it, only a query or an honest uncertain.
    if (idempotencyDeadlinePassed(claimed, this.#clock())) {
      return this.#stopAsUncertain(dispatched, "idempotency-expired");
    }

    await this.#hooks?.checkpoint?.("after-dispatch", dispatched);
    const work = await this.#runWithLease(dispatched, effectiveSignal, async (leaseSignal) => {
      const context = this.#context(dispatched, leaseSignal);
      const value = action.output.parse(await action.execute(input, context));
      assertJsonValue(value, "action output");
      this.#assertPersistable(value, "Action output", dispatched.operationId);
      const receipt = action.receipt?.(value, input);
      if (receipt !== undefined) {
        assertJsonValue(receipt, "action receipt");
        this.#assertPersistable(receipt, "Action receipt", dispatched.operationId);
      }
      return { value, receipt };
    });

    if (work.leaseLost) throw new OperationBusyError(dispatched.operationId);

    if (work.status === "fulfilled") {
      const succeeded = await this.#update(dispatched, {
        state: "succeeded",
        claim: undefined,
        result: work.value.value,
        receipt: work.value.receipt,
        error: undefined,
        uncertainty: undefined,
      });
      if (succeeded === undefined) throw new OperationBusyError(dispatched.operationId);
      return work.value.value;
    }

    const error = work.error;
    if (error instanceof SimulatedProcessCrash || error instanceof OperationBusyError) throw error;

    const context = this.#context(dispatched, effectiveSignal);
    if (
      effectiveSignal.aborted &&
      action.effect.kind === "reconcilable" &&
      action.effect.cancellable &&
      action.cancel !== undefined
    ) {
      try {
        await action.cancel(input, context);
      } catch {
        // Cancellation cannot make an already-dispatched effect less uncertain.
      }
    }

    if (!hasExternalSideEffect(action.effect)) {
      const failed = await this.#update(dispatched, {
        state: effectiveSignal.aborted ? "cancelled" : "failed",
        claim: undefined,
        error: effectiveSignal.aborted ? undefined : this.#safeExecutionError(),
      });
      if (failed === undefined) throw new OperationBusyError(dispatched.operationId);
      if (effectiveSignal.aborted) throw new OperationCancelledError(dispatched.operationId);
      throw error;
    }

    const uncertain = await this.#update(dispatched, {
      state: "uncertain",
      claim: undefined,
      error: undefined,
      uncertainty: {
        reason: effectiveSignal.aborted
          ? "cancel-requested-after-dispatch"
          : "execution-threw-after-dispatch",
        at: this.#now(),
      },
    });
    if (uncertain === undefined) throw new OperationBusyError(dispatched.operationId);
    throw new UncertainOperationError(dispatched.operationId);
  }

  async #recover<I extends JsonValue, O extends JsonValue>(
    action: Action<I, O>,
    input: I,
    claimed: OperationRecord,
    signal?: AbortSignal,
  ): Promise<O> {
    const effectiveSignal = signal ?? new AbortController().signal;
    if (effectiveSignal.aborted) {
      const uncertain = await this.#markUncertain(claimed, "recovery-cancelled");
      if (uncertain === undefined) throw new OperationBusyError(claimed.operationId);
      throw new UncertainOperationError(claimed.operationId);
    }

    const reconcile = action.reconcile;
    if (reconcile !== undefined) {
      const work = await this.#runWithLease(claimed, effectiveSignal, (leaseSignal) =>
        reconcile(input, this.#context(claimed, leaseSignal))
      );
      if (work.leaseLost) throw new OperationBusyError(claimed.operationId);
      if (work.status === "rejected") {
        const uncertain = await this.#markUncertain(claimed, "reconcile-threw");
        if (uncertain === undefined) throw new OperationBusyError(claimed.operationId);
        throw new UncertainOperationError(claimed.operationId);
      }

      const outcome: ReconcileResult<O> = work.value;
      await this.#hooks?.checkpoint?.("after-reconcile", claimed);

      let reconciledValue: O | undefined;
      try {
        if (outcome.status === "succeeded") {
          reconciledValue = action.output.parse(outcome.value);
          assertJsonValue(reconciledValue, "reconciled action output");
          this.#assertPersistable(
            reconciledValue,
            "Reconciled action output",
            claimed.operationId,
          );
        } else if (outcome.status === "failed") {
          assertSafeError(outcome.error);
        }
        if ("receipt" in outcome && outcome.receipt !== undefined) {
          assertJsonValue(outcome.receipt, "reconciliation receipt");
          this.#assertPersistable(
            outcome.receipt,
            "Reconciliation receipt",
            claimed.operationId,
          );
        }
      } catch {
        const uncertain = await this.#markUncertain(claimed, "reconcile-invalid-result");
        if (uncertain === undefined) throw new OperationBusyError(claimed.operationId);
        throw new UncertainOperationError(claimed.operationId);
      }

      if (outcome.status === "succeeded") {
        const value = reconciledValue as O;
        const reconciled = await this.#update(claimed, {
          state: "reconciled",
          claim: undefined,
          result: value,
          receipt: outcome.receipt,
          reconciliation: { outcome: "succeeded", at: this.#now() },
          uncertainty: undefined,
          error: undefined,
        });
        if (reconciled === undefined) throw new OperationBusyError(claimed.operationId);
        return value;
      }

      if (outcome.status === "failed") {
        const reconciled = await this.#update(claimed, {
          state: "reconciled",
          claim: undefined,
          error: outcome.error,
          receipt: outcome.receipt,
          reconciliation: { outcome: "failed", at: this.#now() },
          uncertainty: undefined,
        });
        if (reconciled === undefined) throw new OperationBusyError(claimed.operationId);
        throw new OperationFailedError(claimed.operationId, outcome.error.message);
      }

      if (outcome.status === "absent") {
        const absence = evaluateAuthoritativeAbsence(claimed, outcome, "normal", this.#clock());
        if (absence.kind === "redispatch-same-key") {
          return this.#dispatchAndExecute(action, input, claimed, effectiveSignal);
        }
        return this.#stopAsUncertain(
          claimed,
          absence.kind === "stay-uncertain" ? absence.reason : "reconcile-absent",
        );
      }

      const uncertain = await this.#update(claimed, {
        state: "uncertain",
        claim: undefined,
        receipt: "receipt" in outcome ? outcome.receipt : claimed.receipt,
        uncertainty: { reason: `reconcile-${outcome.status}`, at: this.#now() },
      });
      if (uncertain === undefined) throw new OperationBusyError(claimed.operationId);
      throw new UncertainOperationError(claimed.operationId);
    }

    const decision = evaluateRecovery({
      record: claimed,
      hasReconcile: false,
      operationKeyUsable: usesOperationKey(action.effect),
      mode: "normal",
      now: this.#clock(),
    });
    if (decision.kind === "redispatch-same-key") {
      return this.#dispatchAndExecute(action, input, claimed, effectiveSignal);
    }
    return this.#stopAsUncertain(
      claimed,
      decision.kind === "stay-uncertain" ? decision.reason : "no-safe-recovery-path",
    );
  }

  /** Persist the honest uncertain outcome and surface its stable error. */
  async #stopAsUncertain(record: OperationRecord, reason: string): Promise<never> {
    const uncertain = await this.#markUncertain(record, reason);
    if (uncertain === undefined) throw new OperationBusyError(record.operationId);
    if (reason === "idempotency-expired") {
      throw new IdempotencyExpiredError(record.operationId);
    }
    throw new UncertainOperationError(record.operationId);
  }

  #context(record: OperationRecord, signal: AbortSignal): ActionExecutionContext {
    const fencingToken = record.claim?.fencingToken ?? record.lastFencingToken;
    return {
      operationId: record.operationId,
      idempotencyKey: record.operationId,
      attempt: Math.max(1, record.attempts),
      fencingToken,
      identity: record.identity,
      signal,
    };
  }

  /**
   * Lease-aware execution wrapper (G2 design spec §2): heartbeat renews the
   * lightweight LiveLease only - no semantic revision, history entry or
   * ordering change - and a lost or failing renewal aborts the combined
   * signal so the stale owner cannot write a terminal state.
   */
  async #runWithLease<T>(
    record: OperationRecord,
    callerSignal: AbortSignal,
    work: (signal: AbortSignal) => Promise<T> | T,
  ): Promise<LeaseWorkResult<T>> {
    let stopped = false;
    let leaseLost = false;
    let renewal = Promise.resolve();
    const leaseAbort = new AbortController();
    const signal = AbortSignal.any([callerSignal, leaseAbort.signal]);
    const intervalMs = Math.max(1, Math.floor(this.#leaseMs / 3));
    const claim = record.claim;

    const timer = setInterval(() => {
      renewal = renewal.then(async () => {
        if (stopped || leaseLost || claim === undefined) return;
        try {
          const renewed = await this.ledger.renewLease(
            record.operationId,
            claim.owner,
            claim.fencingToken,
            new Date(this.#clock().getTime() + this.#leaseMs).toISOString(),
          );
          if (!renewed) {
            leaseLost = true;
            leaseAbort.abort(new Error("Ordarium operation lease was lost"));
          }
        } catch {
          leaseLost = true;
          leaseAbort.abort(new Error("Ordarium operation lease renewal failed"));
        }
      });
    }, intervalMs);
    timer.unref();

    let outcome: { status: "fulfilled"; value: T } | { status: "rejected"; error: unknown };
    try {
      outcome = { status: "fulfilled", value: await work(signal) };
    } catch (error) {
      outcome = { status: "rejected", error };
    } finally {
      stopped = true;
      clearInterval(timer);
      await renewal;
    }

    return outcome.status === "fulfilled"
      ? { status: "fulfilled", value: outcome.value, leaseLost }
      : { status: "rejected", error: outcome.error, leaseLost };
  }

  #readTerminal<I extends JsonValue, O extends JsonValue>(
    record: OperationRecord,
    action: Action<I, O>,
  ): { done: false } | { done: true; value: O } {
    if (
      record.state === "succeeded" ||
      (record.state === "reconciled" && record.reconciliation?.outcome === "succeeded")
    ) {
      if (record.result === undefined) {
        throw new OperationFailedError(record.operationId, "Terminal success has no stored result");
      }
      return { done: true, value: action.output.parse(record.result) };
    }
    if (record.state === "denied") {
      throw new ActionDeniedError(record.operationId);
    }
    if (record.state === "cancelled") {
      throw new OperationCancelledError(record.operationId);
    }
    if (
      record.state === "failed" ||
      (record.state === "reconciled" && record.reconciliation?.outcome === "failed")
    ) {
      throw new OperationFailedError(record.operationId, record.error?.message);
    }
    return { done: false };
  }

  #assertCompatible<I extends JsonValue, O extends JsonValue>(
    record: OperationRecord,
    action: Action<I, O>,
    inputDigest: string,
    logicalKeyDigest: string,
  ): void {
    if (
      record.actionName !== action.name ||
      record.actionVersion !== action.version ||
      record.inputDigest !== inputDigest ||
      record.logicalKeyDigest !== logicalKeyDigest
    ) {
      throw new OperationConflictError(record.operationId);
    }
  }

  /**
   * Ledger capability gate (docs/13 §6.1, G1-A10): managed writes require a
   * crash-durable ledger with live lease, semantic history and coordination
   * covering the declared deployment topology. Anything less fails closed
   * before an operation exists; the explicit volatile opt-in is reserved for
   * tests and embedded weak modes with no restart guarantee.
   */
  #assertLedgerEligibility<I extends JsonValue, O extends JsonValue>(
    action: Action<I, O>,
  ): void {
    const kind = action.effect.kind;
    if (kind === "read-only" || kind === "unmanaged") return;
    if (this.#allowVolatileLedger) return;
    const caps = this.ledger.capabilities;
    if (caps.semanticCas !== true) {
      throw new LedgerCapabilityRequiredError("transactional semantic compare-and-set");
    }
    if (caps.durability !== "crash-durable" || !caps.liveLease || !caps.semanticHistory) {
      throw new LedgerCapabilityRequiredError(
        "crash durability, live lease and semantic history for managed writes",
      );
    }
    if (
      COORDINATION_COVERAGE[caps.coordination] < COORDINATION_COVERAGE[this.#deploymentCoordination]
    ) {
      throw new LedgerCapabilityRequiredError(
        `coordination covering a ${this.#deploymentCoordination} deployment (ledger declares ${caps.coordination})`,
      );
    }
  }

  #assertAuthorizationConsistent(record: OperationRecord, options: ActionRunOptions): void {
    const incoming = options.authorization;
    if (incoming === undefined) return;
    assertAuthorizationDecision(incoming);
    const persisted = record.authorization;
    if (persisted !== undefined && persisted.decision !== incoming.decision) {
      throw new AuthorizationConflictError(record.operationId);
    }
  }

  /**
   * Contract drift detection (G1-A04): the first durable fingerprint binds
   * the operation; re-entering the same name+version with drifted schema,
   * effect or hook metadata fails closed with CONTRACT_DRIFT instead of
   * silently reinterpreting persisted state. The fingerprint is a diagnostic
   * - the author's version bump remains the semantic boundary.
   */
  async #applyContractBinding<I extends JsonValue, O extends JsonValue>(
    record: OperationRecord,
    action: Action<I, O>,
  ): Promise<OperationRecord> {
    const fingerprint = contractFingerprint(action);
    if (record.contractFingerprint === undefined) {
      const bound = await this.#update(record, { contractFingerprint: fingerprint });
      if (bound !== undefined) return bound;
      return this.#applyContractBinding(await this.#reload(record.operationId), action);
    }
    if (record.contractFingerprint !== fingerprint) {
      throw new ContractDriftError(record.operationId);
    }
    return record;
  }

  /**
   * Provider principal continuity (docs/13 §2): the first durable digest
   * binds the operation; a later invocation must resolve to the same
   * principal or fail closed. Binding a previously unbound record adopts
   * the presented digest via CAS.
   */
  async #applyPrincipalBinding(
    record: OperationRecord,
    options: ActionRunOptions,
  ): Promise<OperationRecord> {
    const ref = options.providerPrincipalRef;
    if (ref === undefined) {
      if (record.providerPrincipalDigest !== undefined) {
        throw new PrincipalConflictError(record.operationId);
      }
      return record;
    }
    assertProviderPrincipalRef(ref);
    const digest = principalDigestOf(ref);
    if (record.providerPrincipalDigest === undefined) {
      const bound = await this.#update(record, { providerPrincipalDigest: digest });
      if (bound !== undefined) return bound;
      return this.#applyPrincipalBinding(await this.#reload(record.operationId), options);
    }
    if (record.providerPrincipalDigest !== digest) {
      throw new PrincipalConflictError(record.operationId);
    }
    return record;
  }

  async #markUncertain(
    record: OperationRecord,
    reason: string,
  ): Promise<OperationRecord | undefined> {
    return this.#update(record, {
      state: "uncertain",
      claim: undefined,
      uncertainty: { reason, at: this.#now() },
    });
  }

  async #update(
    record: OperationRecord,
    patch: Partial<OperationRecord>,
  ): Promise<OperationRecord | undefined> {
    const next: OperationRecord = {
      ...record,
      ...patch,
      operationId: record.operationId,
      semanticRevision: record.semanticRevision + 1,
      updatedAt: this.#now(),
    };
    const saved = await this.ledger.compareAndSet(record.operationId, record.semanticRevision, next);
    return saved ? next : undefined;
  }

  async #reload(operationId: string): Promise<OperationRecord> {
    const record = await this.ledger.get(operationId);
    if (record === undefined) {
      throw new OperationFailedError(operationId, "Operation disappeared from its ledger");
    }
    return record;
  }

  #safeExecutionError(): SafeError {
    return { code: "ACTION_EXECUTION_FAILED", message: "Action execution failed" };
  }

  #assertPersistable(value: JsonValue, label: string, operationId: string): void {
    const bytes = Buffer.byteLength(canonicalJson(value), "utf8");
    if (bytes > this.#maxPersistedJsonBytes) {
      throw new PersistedValueTooLargeError(operationId, label, this.#maxPersistedJsonBytes);
    }
  }

  #now(): string {
    return this.#clock().toISOString();
  }
}

function idempotencyDeadlineOf<I extends JsonValue, O extends JsonValue>(
  action: Action<I, O>,
  clock: () => Date,
): string | undefined {
  const window = action.effect.kind === "idempotent"
    ? action.effect.window
    : action.effect.kind === "reconcilable"
      ? action.effect.idempotencyWindow
      : undefined;
  if (window?.kind !== "finite") return undefined;
  return new Date(clock().getTime() + window.expiresAfterMs).toISOString();
}

export function operationIdentityPreview<I extends JsonValue, O extends JsonValue>(
  action: Action<I, O>,
  input: unknown,
  identity: InvocationIdentity,
): { operationId: string; inputDigest: string; logicalKeyDigest: string } {
  const parsed = action.input.parse(input);
  assertJsonValue(parsed, "action input");
  assertInvocationIdentity(identity);
  const logicalKey = action.key?.(parsed, identity) ??
    `${identity.source}\u0000${identity.scope}\u0000${identity.callId}`;
  if (logicalKey.length === 0) throw new TypeError("Action logical key must not be empty");
  const logicalKeyDigest = digestJson(logicalKey);
  return {
    operationId: `op_${digestJson({
      action: action.name,
      version: action.version,
      logicalKeyDigest,
    }).slice(0, 40)}`,
    inputDigest: digestJson(parsed),
    logicalKeyDigest,
  };
}

export function describeOperation(record: OperationRecord): string {
  return canonicalJson({
    operationId: record.operationId,
    action: `${record.actionName}@${record.actionVersion}`,
    effect: record.effectKind,
    state: record.state,
    attempts: record.attempts,
  });
}

function directIdentity<I extends JsonValue, O extends JsonValue>(
  action: Action<I, O>,
): InvocationIdentity {
  if (action.effect.kind === "read-only" || action.effect.kind === "unmanaged") {
    return { source: "direct", scope: "process", callId: randomUUID() };
  }
  throw new IdentityRequiredError();
}

function principalDigestOf(ref: ProviderPrincipalRef): string {
  return digestJson({ namespace: ref.namespace, subject: ref.subject });
}

function assertProviderPrincipalRef(ref: ProviderPrincipalRef): void {
  for (const [name, value] of [
    ["namespace", ref.namespace],
    ["subject", ref.subject],
  ] as const) {
    if (typeof value !== "string" || value.length === 0 || value.length > 256) {
      throw new TypeError(`Provider principal ${name} must be a string of 1 to 256 characters`);
    }
  }
}

const AUTHORIZATION_EVIDENCE_KINDS = new Set<AuthorizationEvidenceKind>([
  "host-admission",
  "policy-decision",
  "human-approval",
]);

function assertInvocationIdentity(identity: InvocationIdentity): void {
  for (const [name, value] of [
    ["source", identity.source],
    ["scope", identity.scope],
    ["callId", identity.callId],
  ] as const) {
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.length > RESOURCE_LIMITS.maxIdentityFieldLength
    ) {
      throw new TypeError(
        `Invocation identity ${name} must be a string of 1 to ${RESOURCE_LIMITS.maxIdentityFieldLength} characters`,
      );
    }
  }
  if (
    identity.rootCallId !== undefined &&
    (identity.rootCallId.length === 0 || identity.rootCallId.length > RESOURCE_LIMITS.maxIdentityFieldLength)
  ) {
    throw new TypeError("Invocation identity rootCallId must be a non-empty bounded string");
  }
  if (
    identity.actor !== undefined &&
    (identity.actor.length === 0 || identity.actor.length > RESOURCE_LIMITS.maxIdentityFieldLength)
  ) {
    throw new TypeError("Invocation identity actor must be a non-empty bounded string");
  }
  if (identity.lineage !== undefined) {
    if (
      identity.lineage.length > RESOURCE_LIMITS.maxLineageEntries ||
      identity.lineage.some(
        (item) =>
          typeof item !== "string" ||
          item.length === 0 ||
          item.length > RESOURCE_LIMITS.maxIdentityFieldLength,
      )
    ) {
      throw new TypeError(
        `Invocation identity lineage must contain at most ${RESOURCE_LIMITS.maxLineageEntries} non-empty bounded strings`,
      );
    }
  }
}

function assertAuthorizationDecision(decision: AuthorizationDecision): void {
  if (decision.decision !== "allow" && decision.decision !== "deny") {
    throw new TypeError("Authorization decision must be allow or deny");
  }
  if (
    typeof decision.kind !== "string" ||
    !AUTHORIZATION_EVIDENCE_KINDS.has(decision.kind as AuthorizationEvidenceKind)
  ) {
    throw new TypeError(
      "Authorization evidence kind must be host-admission, policy-decision or human-approval",
    );
  }
  if (typeof decision.source !== "string" || decision.source.length === 0) {
    throw new TypeError("Authorization decision source must be a non-empty string");
  }
  if (decision.reason !== undefined &&
    (typeof decision.reason !== "string" || decision.reason.length > 4_096)) {
    throw new TypeError("Authorization decision reason must be a string of at most 4096 characters");
  }
}

function assertSafeError(error: SafeError): void {
  if (!/^[A-Z][A-Z0-9_]{0,127}$/u.test(error.code)) {
    throw new TypeError("Reconciliation error code must be a stable uppercase identifier");
  }
  if (typeof error.message !== "string" || error.message.length === 0 || error.message.length > 4_096) {
    throw new TypeError("Reconciliation error message must contain 1 to 4096 characters");
  }
}
