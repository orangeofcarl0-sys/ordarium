export type GuaranteeLevel = "read-only" | "guarded" | "idempotent" | "reconcilable" | "unmanaged";
export type IdempotencyMode = "none" | "operation-key";
export interface EffectProfile {
    readonly guarantee: GuaranteeLevel;
    readonly hasExternalSideEffect: boolean;
    readonly requiresAuthorization: boolean;
    readonly idempotency: IdempotencyMode;
    readonly cancellable: boolean;
}
export declare const effects: Readonly<{
    readOnly(): EffectProfile;
    guarded(): EffectProfile;
    idempotent(): EffectProfile;
    reconcilable(options?: {
        idempotency?: IdempotencyMode;
        cancellable?: boolean;
    }): EffectProfile;
    unmanaged(): EffectProfile;
}>;
//# sourceMappingURL=effects.d.ts.map