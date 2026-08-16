export type GuaranteeLevel =
  | "read-only"
  | "guarded"
  | "idempotent"
  | "reconcilable"
  | "unmanaged";

export type IdempotencyWindow =
  | { readonly kind: "durable" }
  | { readonly kind: "finite"; readonly expiresAfterMs: number };

/**
 * A capability cross-section of the Action and its Provider, not a safety
 * score (docs/13 §1.1). The redundant boolean fields of the private v1
 * shape are derived from `kind` instead.
 */
export type EffectProfile =
  | { readonly kind: "read-only" }
  | { readonly kind: "guarded" }
  | { readonly kind: "idempotent"; readonly window: IdempotencyWindow }
  | {
      readonly kind: "reconcilable";
      readonly idempotencyWindow?: IdempotencyWindow | undefined;
      readonly cancellable: boolean;
    }
  | { readonly kind: "unmanaged" };

function freeze(profile: EffectProfile): EffectProfile {
  return Object.freeze(profile);
}

export const effects = Object.freeze({
  readOnly(): EffectProfile {
    return freeze({ kind: "read-only" });
  },

  guarded(): EffectProfile {
    return freeze({ kind: "guarded" });
  },

  idempotent(options: { window?: IdempotencyWindow } = {}): EffectProfile {
    return freeze({ kind: "idempotent", window: options.window ?? { kind: "durable" } });
  },

  reconcilable(options: {
    idempotencyWindow?: IdempotencyWindow;
    cancellable?: boolean;
  } = {}): EffectProfile {
    return freeze({
      kind: "reconcilable",
      ...(options.idempotencyWindow === undefined
        ? {}
        : { idempotencyWindow: options.idempotencyWindow }),
      cancellable: options.cancellable ?? false,
    });
  },

  unmanaged(): EffectProfile {
    return freeze({ kind: "unmanaged" });
  },
});

/** Managed writes (guarded/idempotent/reconcilable) require authorization evidence. */
export function requiresAuthorization(effect: EffectProfile): boolean {
  return effect.kind !== "read-only" && effect.kind !== "unmanaged";
}

/** Only read-only actions provably create no external side effect. */
export function hasExternalSideEffect(effect: EffectProfile): boolean {
  return effect.kind !== "read-only";
}

/**
 * True when the Action may be re-executed with the same operation key:
 * an idempotent profile, or a reconcilable profile that also declares an
 * idempotency window.
 */
export function usesOperationKey(effect: EffectProfile): boolean {
  return effect.kind === "idempotent" ||
    (effect.kind === "reconcilable" && effect.idempotencyWindow !== undefined);
}
