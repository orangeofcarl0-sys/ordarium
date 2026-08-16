import type { EffectProfile } from "./effects.js";
import type { ActionSchema, JsonValue } from "./json.js";
import type { AuthorizationDecision, InvocationIdentity, SafeError } from "./types.js";
export interface ActionExecutionContext {
    operationId: string;
    idempotencyKey: string;
    attempt: number;
    fencingToken: number;
    identity: InvocationIdentity;
    signal: AbortSignal;
}
export type ReconcileResult<O extends JsonValue> = {
    status: "succeeded";
    value: O;
    receipt?: JsonValue | undefined;
} | {
    status: "failed";
    error: SafeError;
    receipt?: JsonValue | undefined;
} | {
    status: "absent";
    retrySafe: boolean;
} | {
    status: "pending";
    receipt?: JsonValue | undefined;
} | {
    status: "unknown";
    receipt?: JsonValue | undefined;
};
export interface ActionRunOptions {
    identity?: InvocationIdentity | undefined;
    authorization?: AuthorizationDecision | undefined;
    signal?: AbortSignal | undefined;
}
export interface ActionRunner {
    run<I extends JsonValue, O extends JsonValue>(action: Action<I, O>, input: unknown, options?: ActionRunOptions): Promise<O>;
}
export interface Action<I extends JsonValue, O extends JsonValue> {
    readonly name: string;
    readonly version: string;
    readonly description: string;
    readonly input: ActionSchema<I>;
    readonly output: ActionSchema<O>;
    readonly effect: EffectProfile;
    readonly key?: ((input: I, identity: InvocationIdentity) => string) | undefined;
    readonly execute: (input: I, context: ActionExecutionContext) => Promise<O> | O;
    readonly reconcile?: ((input: I, context: ActionExecutionContext) => Promise<ReconcileResult<O>> | ReconcileResult<O>) | undefined;
    readonly cancel?: ((input: I, context: ActionExecutionContext) => Promise<void> | void) | undefined;
    readonly receipt?: ((value: O, input: I) => JsonValue | undefined) | undefined;
    run(runtime: ActionRunner, input: unknown, options?: ActionRunOptions): Promise<O>;
}
export type ActionDefinition<I extends JsonValue, O extends JsonValue> = Omit<Action<I, O>, "run">;
export declare function defineAction<I extends JsonValue, O extends JsonValue>(definition: ActionDefinition<I, O>): Action<I, O>;
//# sourceMappingURL=action.d.ts.map