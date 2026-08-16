import {
  SimulatedProcessCrash,
  canonicalJson,
  defineAction,
  defineSchema,
  digestJson,
  type Action,
  type EffectProfile,
  type JsonValue,
  type ReconcileResult,
} from "@ordarium/core";

/**
 * Provider capability conformance kit (G6 design spec). A capability
 * declaration is a claim; this module turns claims into reproducible
 * evidence through a deterministic fixture provider and cross-validation
 * against the effect profiles authors select.
 */

export interface ProviderCapabilityDeclaration {
  readonly provider: string;
  readonly idempotency: "none" | "durable-key" | "finite-key";
  readonly query: "none" | "by-business-key";
  readonly authoritativeAbsence: boolean;
  readonly cancellation: "none" | "best-effort";
  readonly fencing: boolean;
  readonly principalNamespacing: boolean;
}

export function providerCapabilityFingerprint(
  declaration: ProviderCapabilityDeclaration,
): string {
  return digestJson({
    provider: declaration.provider,
    idempotency: declaration.idempotency,
    query: declaration.query,
    authoritativeAbsence: declaration.authoritativeAbsence,
    cancellation: declaration.cancellation,
    fencing: declaration.fencing,
    principalNamespacing: declaration.principalNamespacing,
  });
}

/**
 * Cross-validation (G6-A11): an effect profile may only be paired with a
 * declaration whose provider primitives actually back it. A failing pairing
 * must downgrade to a proven profile instead of claiming blanket idempotency.
 */
export function assertEffectSupportedByDeclaration(
  effect: EffectProfile,
  declaration: ProviderCapabilityDeclaration,
): void {
  const needsKey = effect.kind === "idempotent" ||
    (effect.kind === "reconcilable" && effect.idempotencyWindow !== undefined);
  if (needsKey && declaration.idempotency === "none") {
    throw new TypeError(
      `${declaration.provider} declares no operation-key idempotency; use effects.guarded() or add reconcile capability`,
    );
  }
  if (
    effect.kind === "idempotent" &&
    effect.window.kind === "finite" &&
    declaration.idempotency !== "finite-key" &&
    declaration.idempotency !== "durable-key"
  ) {
    throw new TypeError(
      `${declaration.provider} cannot back a finite idempotency window (declares ${declaration.idempotency})`,
    );
  }
  if (effect.kind === "reconcilable" && declaration.query !== "by-business-key" && !needsKey) {
    throw new TypeError(
      `${declaration.provider} declares no business-key query; a reconcilable profile needs query or idempotency`,
    );
  }
  if (
    effect.kind === "reconcilable" &&
    effect.cancellable &&
    declaration.cancellation === "none"
  ) {
    throw new TypeError(
      `${declaration.provider} declares no cancellation primitive; cancellable requires best-effort cancel`,
    );
  }
}

export class ProviderResponseLostError extends Error {
  constructor() {
    super("The provider effect was committed but its response never arrived");
    this.name = "ProviderResponseLostError";
  }
}

export class ProviderKeyConflictError extends Error {
  constructor(key: string) {
    super(`The provider rejected a reused operation key with different input: ${key}`);
    this.name = "ProviderKeyConflictError";
  }
}

export class ProviderStaleFenceError extends Error {
  constructor(key: string, fence: number) {
    super(`The provider rejected a stale fencing token ${fence} for ${key}`);
    this.name = "ProviderStaleFenceError";
  }
}

export type ProviderQueryFact =
  | { status: "absent"; authoritative: boolean }
  | { status: "pending" }
  | { status: "succeeded"; value: JsonValue }
  | { status: "failed"; message: string };

export interface ProviderFixtureOptions {
  readonly declaration: ProviderCapabilityDeclaration;
}

/**
 * Deterministic in-memory provider honouring its declaration exactly (G6
 * design spec §2): execute/query/cancel counters, a business-effect store
 * keyed by operation key, and switchable faults - response loss, eventual
 * false absence, pending windows and stale-fence rejection.
 */
export class ProviderFixture {
  readonly declaration: ProviderCapabilityDeclaration;
  readonly calls = { execute: 0, query: 0, cancel: 0 };
  readonly #effects = new Map<string, JsonValue>();
  readonly #keyInputs = new Map<string, string>();
  readonly #maxFence = new Map<string, number>();
  #loseResponseOnce = false;
  #eventualAbsenceOnce = false;
  #pendingOnce = false;

  constructor(options: ProviderFixtureOptions) {
    this.declaration = options.declaration;
  }

  /** Business effects actually created - the number end-to-end safety cares about. */
  effectCount(): number {
    return this.#effects.size;
  }

  loseResponseOnce(): void {
    this.#loseResponseOnce = true;
  }

  eventualAbsenceOnce(): void {
    this.#eventualAbsenceOnce = true;
  }

  pendingOnce(): void {
    this.#pendingOnce = true;
  }

  async execute(
    key: string,
    input: JsonValue,
    fencingToken?: number,
  ): Promise<JsonValue> {
    this.calls.execute += 1;
    if (
      this.declaration.fencing &&
      fencingToken !== undefined &&
      fencingToken < (this.#maxFence.get(key) ?? 0)
    ) {
      throw new ProviderStaleFenceError(key, fencingToken);
    }
    if (fencingToken !== undefined) {
      this.#maxFence.set(key, Math.max(this.#maxFence.get(key) ?? 0, fencingToken));
    }

    if (this.declaration.idempotency !== "none") {
      const recordedInput = this.#keyInputs.get(key);
      if (recordedInput !== undefined) {
        if (recordedInput !== canonicalJson(input)) {
          throw new ProviderKeyConflictError(key);
        }
        return this.#effects.get(key) as JsonValue;
      }
      this.#keyInputs.set(key, canonicalJson(input));
    }

    const value = { key, at: this.calls.execute } as JsonValue;
    this.#effects.set(key, value);
    if (this.#loseResponseOnce) {
      this.#loseResponseOnce = false;
      throw new ProviderResponseLostError();
    }
    return value;
  }

  async query(key: string): Promise<ProviderQueryFact> {
    this.calls.query += 1;
    if (this.#pendingOnce) {
      this.#pendingOnce = false;
      return { status: "pending" };
    }
    if (this.declaration.query !== "by-business-key") {
      throw new TypeError(`${this.declaration.provider} declares no query primitive`);
    }
    if (this.#eventualAbsenceOnce) {
      this.#eventualAbsenceOnce = false;
      return { status: "absent", authoritative: false };
    }
    const value = this.#effects.get(key);
    if (value === undefined) {
      return { status: "absent", authoritative: this.declaration.authoritativeAbsence };
    }
    return { status: "succeeded", value };
  }

  async cancel(key: string): Promise<"accepted" | "unsupported"> {
    if (this.declaration.cancellation === "none") {
      return "unsupported";
    }
    this.calls.cancel += 1;
    return "accepted";
  }
}

/** Seven declaration presets covering the conformance matrix. */
export const providerDeclarations = {
  opaque(): ProviderCapabilityDeclaration {
    return {
      provider: "opaque-provider",
      idempotency: "none",
      query: "none",
      authoritativeAbsence: false,
      cancellation: "none",
      fencing: false,
      principalNamespacing: false,
    };
  },
  durableIdempotent(): ProviderCapabilityDeclaration {
    return {
      provider: "durable-key-provider",
      idempotency: "durable-key",
      query: "none",
      authoritativeAbsence: false,
      cancellation: "none",
      fencing: false,
      principalNamespacing: true,
    };
  },
  finiteIdempotent(): ProviderCapabilityDeclaration {
    return {
      provider: "finite-key-provider",
      idempotency: "finite-key",
      query: "none",
      authoritativeAbsence: false,
      cancellation: "none",
      fencing: false,
      principalNamespacing: true,
    };
  },
  reconcilable(): ProviderCapabilityDeclaration {
    return {
      provider: "queryable-provider",
      idempotency: "none",
      query: "by-business-key",
      authoritativeAbsence: true,
      cancellation: "none",
      fencing: false,
      principalNamespacing: true,
    };
  },
  falseAbsence(): ProviderCapabilityDeclaration {
    return {
      provider: "eventual-provider",
      idempotency: "none",
      query: "by-business-key",
      authoritativeAbsence: false,
      cancellation: "none",
      fencing: false,
      principalNamespacing: true,
    };
  },
  cancellable(): ProviderCapabilityDeclaration {
    return {
      provider: "cancellable-provider",
      idempotency: "none",
      query: "by-business-key",
      authoritativeAbsence: true,
      cancellation: "best-effort",
      fencing: false,
      principalNamespacing: true,
    };
  },
  fenced(): ProviderCapabilityDeclaration {
    return {
      provider: "fenced-provider",
      idempotency: "durable-key",
      query: "by-business-key",
      authoritativeAbsence: true,
      cancellation: "none",
      fencing: true,
      principalNamespacing: true,
    };
  },
} as const;

/**
 * Bind a fixture-backed action (the reference adapter shape): execute and
 * optional reconcile/cancel hooks are wired strictly to what the declaration
 * proves, so the conformance scenarios drive a real runtime against provider
 * behaviour that matches its claims.
 */
export function providerBackedAction(
  fixture: ProviderFixture,
  options: {
    name: string;
    effect: EffectProfile;
    keyOf: (input: JsonValue) => string;
  },
): Action<JsonValue, JsonValue> {
  assertEffectSupportedByDeclaration(options.effect, fixture.declaration);
  const queryable = fixture.declaration.query === "by-business-key";
  const cancellable =
    options.effect.kind === "reconcilable" && options.effect.cancellable;
  return defineAction({
    name: options.name,
    version: "1",
    description: `Conformance action backed by ${fixture.declaration.provider}`,
    input: defineSchema<JsonValue>({}, (value) => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("expected a JSON object input");
      }
      return value as JsonValue;
    }),
    output: defineSchema<JsonValue>({}, (value) => value as JsonValue),
    effect: options.effect,
    key: (input) => options.keyOf(input),
    execute: (input, context) =>
      fixture.execute(options.keyOf(input), input, context.fencingToken),
    ...(queryable
      ? {
          reconcile: async (input: JsonValue): Promise<ReconcileResult<JsonValue>> =>
            mapQueryFact(await fixture.query(options.keyOf(input))),
        }
      : {}),
    ...(cancellable
      ? { cancel: (input: JsonValue) => void fixture.cancel(options.keyOf(input)) }
      : {}),
  });
}

export function mapQueryFact(fact: ProviderQueryFact): ReconcileResult<JsonValue> {
  switch (fact.status) {
    case "succeeded":
      return { status: "succeeded", value: fact.value };
    case "failed":
      return { status: "failed", error: { code: "PROVIDER_FAILED", message: fact.message } };
    case "pending":
      return { status: "pending" };
    case "absent":
      return { status: "absent", retrySafe: fact.authoritative };
  }
}

/** Crash-after-dispatch hook for recovery scenarios. */
export function crashAfterDispatch(): { checkpoint: () => void } {
  return {
    checkpoint: () => {
      throw new SimulatedProcessCrash();
    },
  };
}
