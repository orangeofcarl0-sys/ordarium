import { randomUUID } from "node:crypto";

import type {
  Action,
  ActionExecutionContext,
  ActionRunOptions,
  ActionRunner,
  ReconcileResult,
} from "./action.js";
import {
  ActionDeniedError,
  AuthorizationConflictError,
  AuthorizationRequiredError,
  IdentityRequiredError,
  OperationBusyError,
  OperationCancelledError,
  OperationConflictError,
  OperationFailedError,
  PersistedValueTooLargeError,
  PrincipalConflictError,
  SimulatedProcessCrash,
  UncertainOperationError,
} from "./errors.js";
import { assertJsonValue, canonicalJson, digestJson, type JsonValue } from "./json.js";
import {
  hasExternalSideEffect,
  requiresAuthorization,
  usesOperationKey,
} from "./effects.js";
import { MemoryLedger } from "./ledger.js";
import type { HostInvocation, HostInvocationPort } from "./host.js";
import type {
  AuthorizationDecision,
  AuthorizationEvidenceKind,
  InvocationIdentity,
  OperationLedger,
  OperationRecord,
  ProviderPrincipalRef,
  SafeError,
} from "./types.js";

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
}

interface InFlight {
  inputDigest: string;
  promise: Promise<JsonValue>;
}

type LeaseWorkResult<T> =
  | { status: "fulfilled"; value: T; record: OperationRecord; leaseLost: boolean }
  | { status: "rejected"; error: unknown; record: OperationRecord; leaseLost: boolean };

export class OrdariumRuntime implements ActionRunner, HostInvocationPort {
  readonly ledger: OperationLedger;
  readonly #authorizer?: Authorizer | undefined;
  readonly #ownerId: string;
  readonly #leaseMs: number;
  readonly #clock: () => Date;
  readonly #hooks?: RuntimeHooks | undefined;
  readonly #maxPersistedJsonBytes: number;
  readonly #inFlight = new Map<string, InFlight>();

  constructor(options: OrdariumRuntimeOptions = {}) {
    this.ledger = options.ledger ?? new MemoryLedger();
    this.#authorizer = options.authorizer;
    this.#ownerId = options.ownerId ?? `runtime-${randomUUID()}`;
    this.#leaseMs = Math.max(1, options.leaseMs ?? 30_000);
    this.#clock = options.clock ?? (() => new Date());
    this.#hooks = options.hooks;
    this.#maxPersistedJsonBytes = options.maxPersistedJsonBytes ?? 1_048_576;
    if (!Number.isSafeInteger(this.#maxPersistedJsonBytes) || this.#maxPersistedJsonBytes <= 0) {
      throw new TypeError("maxPersistedJsonBytes must be a positive safe integer");
    }
  }

  async run<I extends JsonValue, O extends JsonValue>(
    action: Action<I, O>,
    unknownInput: unknown,
    options: ActionRunOptions = {},
  ): Promise<O> {
    const input = action.input.parse(unknownInput);
    assertJsonValue(input, "action input");
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

    const promise = this.#runInternal(
      action,
      input,
      identity,
      operationId,
      logicalKeyDigest,
      inputDigest,
      options,
    );
    this.#inFlight.set(operationId, { inputDigest, promise });
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

  async close(): Promise<void> {
    await this.ledger.close?.();
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
      schemaVersion: 1,
      operationId,
      actionName: action.name,
      actionVersion: action.version,
      inputDigest,
      logicalKeyDigest,
      identity,
      guarantee: action.effect.kind,
      state: "proposed",
      revision: 0,
      attempts: 0,
      lastFencingToken: 0,
      createdAt: now,
      updatedAt: now,
      ...(principalDigest === undefined ? {} : { providerPrincipalDigest: principalDigest }),
    });
    let record = created.record;
    this.#assertCompatible(record, action, inputDigest, logicalKeyDigest);
    this.#assertAuthorizationConsistent(record, options);
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
        if (record.claim?.owner !== this.#ownerId) {
          if (record.claim !== undefined && Date.parse(record.claim.expiresAt) > this.#clock().getTime()) {
            throw new OperationBusyError(operationId);
          }
          const reclaimed = await this.#claim(record, record.resumeFrom ?? "uncertain");
          if (reclaimed === undefined) {
            record = await this.#reload(operationId);
            continue;
          }
          record = reclaimed;
        }

        const resumeFrom = record.resumeFrom ?? "uncertain";
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

  async #claim(
    record: OperationRecord,
    resumeFrom: "authorized" | "dispatched" | "uncertain",
  ): Promise<OperationRecord | undefined> {
    if (
      record.claim !== undefined &&
      record.claim.owner !== this.#ownerId &&
      Date.parse(record.claim.expiresAt) > this.#clock().getTime()
    ) {
      throw new OperationBusyError(record.operationId);
    }
    const fencingToken = record.lastFencingToken + 1;
    return this.#update(record, {
      state: "claimed",
      resumeFrom,
      lastFencingToken: fencingToken,
      claim: {
        owner: this.#ownerId,
        expiresAt: new Date(this.#clock().getTime() + this.#leaseMs).toISOString(),
        fencingToken,
      },
    });
  }

  async #dispatchAndExecute<I extends JsonValue, O extends JsonValue>(
    action: Action<I, O>,
    input: I,
    claimed: OperationRecord,
    signal?: AbortSignal,
  ): Promise<O> {
    const effectiveSignal = signal ?? new AbortController().signal;
    if (effectiveSignal.aborted) {
      const state = claimed.resumeFrom === "authorized" ? "cancelled" : "uncertain";
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
      resumeFrom: undefined,
      uncertainty: undefined,
    });
    if (dispatched === undefined) throw new OperationBusyError(claimed.operationId);

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
      const succeeded = await this.#update(work.record, {
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

    const context = this.#context(work.record, effectiveSignal);
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
      const failed = await this.#update(work.record, {
        state: effectiveSignal.aborted ? "cancelled" : "failed",
        claim: undefined,
        error: effectiveSignal.aborted ? undefined : this.#safeExecutionError(),
      });
      if (failed === undefined) throw new OperationBusyError(dispatched.operationId);
      if (effectiveSignal.aborted) throw new OperationCancelledError(dispatched.operationId);
      throw error;
    }

    const uncertain = await this.#update(work.record, {
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
      claimed = work.record;
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
          resumeFrom: undefined,
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
          resumeFrom: undefined,
          error: outcome.error,
          receipt: outcome.receipt,
          reconciliation: { outcome: "failed", at: this.#now() },
          uncertainty: undefined,
        });
        if (reconciled === undefined) throw new OperationBusyError(claimed.operationId);
        throw new OperationFailedError(claimed.operationId, outcome.error.message);
      }

      if (outcome.status === "absent" && outcome.retrySafe) {
        return this.#dispatchAndExecute(action, input, claimed, effectiveSignal);
      }

      const uncertain = await this.#update(claimed, {
        state: "uncertain",
        claim: undefined,
        resumeFrom: undefined,
        receipt: "receipt" in outcome ? outcome.receipt : claimed.receipt,
        uncertainty: { reason: `reconcile-${outcome.status}`, at: this.#now() },
      });
      if (uncertain === undefined) throw new OperationBusyError(claimed.operationId);
      throw new UncertainOperationError(claimed.operationId);
    }

    if (usesOperationKey(action.effect)) {
      return this.#dispatchAndExecute(action, input, claimed, effectiveSignal);
    }

    const uncertain = await this.#markUncertain(claimed, "no-safe-recovery-path");
    if (uncertain === undefined) throw new OperationBusyError(claimed.operationId);
    throw new UncertainOperationError(claimed.operationId);
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

  async #runWithLease<T>(
    record: OperationRecord,
    callerSignal: AbortSignal,
    work: (signal: AbortSignal) => Promise<T> | T,
  ): Promise<LeaseWorkResult<T>> {
    let current = record;
    let stopped = false;
    let leaseLost = false;
    let renewal = Promise.resolve();
    const leaseAbort = new AbortController();
    const signal = AbortSignal.any([callerSignal, leaseAbort.signal]);
    const intervalMs = Math.max(1, Math.floor(this.#leaseMs / 3));

    const timer = setInterval(() => {
      renewal = renewal.then(async () => {
        if (stopped || leaseLost) return;
        const claim = current.claim;
        if (claim === undefined || claim.owner !== this.#ownerId) {
          leaseLost = true;
          leaseAbort.abort(new Error("Ordarium operation claim was lost"));
          return;
        }
        try {
          const renewed = await this.#update(current, {
            claim: {
              ...claim,
              expiresAt: new Date(this.#clock().getTime() + this.#leaseMs).toISOString(),
            },
          });
          if (renewed === undefined) {
            leaseLost = true;
            leaseAbort.abort(new Error("Ordarium operation claim was superseded"));
            return;
          }
          current = renewed;
        } catch (error) {
          leaseLost = true;
          leaseAbort.abort(error);
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
      ? { status: "fulfilled", value: outcome.value, record: current, leaseLost }
      : { status: "rejected", error: outcome.error, record: current, leaseLost };
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
      resumeFrom: undefined,
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
      revision: record.revision + 1,
      updatedAt: this.#now(),
    };
    const saved = await this.ledger.compareAndSet(record.operationId, record.revision, next);
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
    guarantee: record.guarantee,
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

function assertInvocationIdentity(identity: InvocationIdentity): void {
  for (const [name, value] of [
    ["source", identity.source],
    ["scope", identity.scope],
    ["callId", identity.callId],
  ] as const) {
    if (typeof value !== "string" || value.length === 0) {
      throw new TypeError(`Invocation identity ${name} must be a non-empty string`);
    }
  }
  if (identity.rootCallId !== undefined && identity.rootCallId.length === 0) {
    throw new TypeError("Invocation identity rootCallId must not be empty");
  }
  if (identity.actor !== undefined && identity.actor.length === 0) {
    throw new TypeError("Invocation identity actor must not be empty");
  }
  if (identity.lineage?.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new TypeError("Invocation identity lineage must contain non-empty strings");
  }
}

const AUTHORIZATION_EVIDENCE_KINDS = new Set<AuthorizationEvidenceKind>([
  "host-admission",
  "policy-decision",
  "human-approval",
]);

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
