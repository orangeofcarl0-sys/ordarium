import { type Action, type EffectProfile, type JsonValue, type ReconcileResult } from "@ordarium/core";
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
export declare function providerCapabilityFingerprint(declaration: ProviderCapabilityDeclaration): string;
/**
 * Cross-validation (G6-A11): an effect profile may only be paired with a
 * declaration whose provider primitives actually back it. A failing pairing
 * must downgrade to a proven profile instead of claiming blanket idempotency.
 */
export declare function assertEffectSupportedByDeclaration(effect: EffectProfile, declaration: ProviderCapabilityDeclaration): void;
export declare class ProviderResponseLostError extends Error {
    constructor();
}
export declare class ProviderKeyConflictError extends Error {
    constructor(key: string);
}
export declare class ProviderStaleFenceError extends Error {
    constructor(key: string, fence: number);
}
export type ProviderQueryFact = {
    status: "absent";
    authoritative: boolean;
} | {
    status: "pending";
} | {
    status: "succeeded";
    value: JsonValue;
} | {
    status: "failed";
    message: string;
};
export interface ProviderFixtureOptions {
    readonly declaration: ProviderCapabilityDeclaration;
}
/**
 * Deterministic in-memory provider honouring its declaration exactly (G6
 * design spec §2): execute/query/cancel counters, a business-effect store
 * keyed by operation key, and switchable faults - response loss, eventual
 * false absence, pending windows and stale-fence rejection.
 */
export declare class ProviderFixture {
    #private;
    readonly declaration: ProviderCapabilityDeclaration;
    readonly calls: {
        execute: number;
        query: number;
        cancel: number;
    };
    constructor(options: ProviderFixtureOptions);
    /** Business effects actually created - the number end-to-end safety cares about. */
    effectCount(): number;
    loseResponseOnce(): void;
    eventualAbsenceOnce(): void;
    pendingOnce(): void;
    execute(key: string, input: JsonValue, fencingToken?: number): Promise<JsonValue>;
    query(key: string): Promise<ProviderQueryFact>;
    cancel(key: string): Promise<"accepted" | "unsupported">;
}
/** Seven declaration presets covering the conformance matrix. */
export declare const providerDeclarations: {
    readonly opaque: () => ProviderCapabilityDeclaration;
    readonly durableIdempotent: () => ProviderCapabilityDeclaration;
    readonly finiteIdempotent: () => ProviderCapabilityDeclaration;
    readonly reconcilable: () => ProviderCapabilityDeclaration;
    readonly falseAbsence: () => ProviderCapabilityDeclaration;
    readonly cancellable: () => ProviderCapabilityDeclaration;
    readonly fenced: () => ProviderCapabilityDeclaration;
};
/**
 * Bind a fixture-backed action (the reference adapter shape): execute and
 * optional reconcile/cancel hooks are wired strictly to what the declaration
 * proves, so the conformance scenarios drive a real runtime against provider
 * behaviour that matches its claims.
 */
export declare function providerBackedAction(fixture: ProviderFixture, options: {
    name: string;
    effect: EffectProfile;
    keyOf: (input: JsonValue) => string;
}): Action<JsonValue, JsonValue>;
export declare function mapQueryFact(fact: ProviderQueryFact): ReconcileResult<JsonValue>;
/** Crash-after-dispatch hook for recovery scenarios. */
export declare function crashAfterDispatch(): {
    checkpoint: () => void;
};
//# sourceMappingURL=provider.d.ts.map