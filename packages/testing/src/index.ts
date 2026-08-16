import {
  SimulatedProcessCrash,
  type Action,
  type AuthorizationDecision,
  type HostInvocation,
  type HostInvocationPort,
  type InvocationIdentity,
  type JsonValue,
  type OperationRecord,
  type ProviderPrincipalRef,
  type RuntimeCheckpoint,
  type RuntimeHooks,
} from "@ordarium/core";

export class FaultInjector implements RuntimeHooks {
  readonly #remaining = new Map<RuntimeCheckpoint, number>();

  crashAt(checkpoint: RuntimeCheckpoint, times = 1): this {
    this.#remaining.set(checkpoint, Math.max(0, times));
    return this;
  }

  checkpoint(name: RuntimeCheckpoint, record: OperationRecord): void {
    const remaining = this.#remaining.get(name) ?? 0;
    if (remaining <= 0) {
      return;
    }
    this.#remaining.set(name, remaining - 1);
    throw new SimulatedProcessCrash(record.operationId);
  }
}

export class ManualClock {
  #milliseconds: number;

  constructor(initial = "2026-01-01T00:00:00.000Z") {
    this.#milliseconds = new Date(initial).getTime();
    if (!Number.isFinite(this.#milliseconds)) {
      throw new TypeError("ManualClock requires a valid initial date");
    }
  }

  now = (): Date => new Date(this.#milliseconds);

  advance(milliseconds: number): void {
    this.#milliseconds += milliseconds;
  }
}

export function fixedIdentity(overrides: Partial<InvocationIdentity> = {}): InvocationIdentity {
  return {
    source: "test",
    scope: "suite",
    callId: "call-1",
    ...overrides,
  };
}

export interface HostHarnessCallOptions {
  callId?: string | undefined;
  rootCallId?: string | undefined;
  actor?: string | undefined;
  lineage?: string[] | undefined;
  authorization?: AuthorizationDecision | undefined;
  providerPrincipalRef?: ProviderPrincipalRef | undefined;
  signal?: AbortSignal | undefined;
}

export interface HostAdapterHarnessOptions {
  source?: string | undefined;
  scope?: string | undefined;
}

/**
 * Deterministic stand-in host that exercises the full HostInvocationPort
 * contract (stable identity, optional classified authorization, signal).
 * Used by the G1 host-adapter conformance suite and as the test base for
 * real adapters (DSH, host-mcp) in G5.
 */
export class HostAdapterHarness {
  readonly #port: HostInvocationPort;
  readonly #source: string;
  readonly #scope: string;
  #counter = 0;

  constructor(port: HostInvocationPort, options: HostAdapterHarnessOptions = {}) {
    this.#port = port;
    this.#source = options.source ?? "harness";
    this.#scope = options.scope ?? "conformance";
  }

  invoke<I extends JsonValue, O extends JsonValue>(
    action: Action<I, O>,
    input: unknown,
    options: HostHarnessCallOptions = {},
  ): Promise<O> {
    const callId = options.callId ?? `call-${(this.#counter += 1)}`;
    const identity: InvocationIdentity = {
      source: this.#source,
      scope: this.#scope,
      callId,
      ...(options.rootCallId === undefined ? {} : { rootCallId: options.rootCallId }),
      ...(options.actor === undefined ? {} : { actor: options.actor }),
      ...(options.lineage === undefined ? {} : { lineage: options.lineage }),
    };
    const invocation: HostInvocation = {
      identity,
      ...(options.authorization === undefined ? {} : { authorization: options.authorization }),
      ...(options.providerPrincipalRef === undefined
        ? {}
        : { providerPrincipalRef: options.providerPrincipalRef }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    };
    return this.#port.invoke(action, input, invocation);
  }
}
