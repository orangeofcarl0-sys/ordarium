export type GuaranteeLevel = "read-only" | "guarded" | "idempotent" | "reconcilable" | "unmanaged";
export type IdempotencyWindow = {
    readonly kind: "durable";
} | {
    readonly kind: "finite";
    readonly expiresAfterMs: number;
};
/**
 * A capability cross-section of the Action and its Provider, not a safety
 * score (docs/13 §1.1). The redundant boolean fields of the private v1
 * shape are derived from `kind` instead.
 */
export type EffectProfile = {
    readonly kind: "read-only";
} | {
    readonly kind: "guarded";
} | {
    readonly kind: "idempotent";
    readonly window: IdempotencyWindow;
} | {
    readonly kind: "reconcilable";
    readonly idempotencyWindow?: IdempotencyWindow | undefined;
    readonly cancellable: boolean;
} | {
    readonly kind: "unmanaged";
};
export declare const effects: Readonly<{
    readOnly(): EffectProfile;
    guarded(): EffectProfile;
    idempotent(options?: {
        window?: IdempotencyWindow;
    }): EffectProfile;
    reconcilable(options?: {
        idempotencyWindow?: IdempotencyWindow;
        cancellable?: boolean;
    }): EffectProfile;
    unmanaged(): EffectProfile;
}>;
/** Managed writes (guarded/idempotent/reconcilable) require authorization evidence. */
export declare function requiresAuthorization(effect: EffectProfile): boolean;
/** Only read-only actions provably create no external side effect. */
export declare function hasExternalSideEffect(effect: EffectProfile): boolean;
/**
 * True when the Action may be re-executed with the same operation key:
 * an idempotent profile, or a reconcilable profile that also declares an
 * idempotency window.
 */
export declare function usesOperationKey(effect: EffectProfile): boolean;
//# sourceMappingURL=effects.d.ts.map