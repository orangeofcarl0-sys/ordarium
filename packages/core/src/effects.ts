export type GuaranteeLevel =
  | "read-only"
  | "guarded"
  | "idempotent"
  | "reconcilable"
  | "unmanaged";

export type IdempotencyMode = "none" | "operation-key";

export interface EffectProfile {
  readonly guarantee: GuaranteeLevel;
  readonly hasExternalSideEffect: boolean;
  readonly requiresAuthorization: boolean;
  readonly idempotency: IdempotencyMode;
  readonly cancellable: boolean;
}

function freeze(profile: EffectProfile): EffectProfile {
  return Object.freeze(profile);
}

export const effects = Object.freeze({
  readOnly(): EffectProfile {
    return freeze({
      guarantee: "read-only",
      hasExternalSideEffect: false,
      requiresAuthorization: false,
      idempotency: "none",
      cancellable: true,
    });
  },

  guarded(): EffectProfile {
    return freeze({
      guarantee: "guarded",
      hasExternalSideEffect: true,
      requiresAuthorization: true,
      idempotency: "none",
      cancellable: false,
    });
  },

  idempotent(): EffectProfile {
    return freeze({
      guarantee: "idempotent",
      hasExternalSideEffect: true,
      requiresAuthorization: true,
      idempotency: "operation-key",
      cancellable: false,
    });
  },

  reconcilable(options: {
    idempotency?: IdempotencyMode;
    cancellable?: boolean;
  } = {}): EffectProfile {
    return freeze({
      guarantee: "reconcilable",
      hasExternalSideEffect: true,
      requiresAuthorization: true,
      idempotency: options.idempotency ?? "none",
      cancellable: options.cancellable ?? false,
    });
  },

  unmanaged(): EffectProfile {
    return freeze({
      guarantee: "unmanaged",
      hasExternalSideEffect: true,
      requiresAuthorization: false,
      idempotency: "none",
      cancellable: false,
    });
  },
});
