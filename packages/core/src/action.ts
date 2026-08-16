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

export type ReconcileResult<O extends JsonValue> =
  | { status: "succeeded"; value: O; receipt?: JsonValue | undefined }
  | { status: "failed"; error: SafeError; receipt?: JsonValue | undefined }
  | { status: "absent"; retrySafe: boolean }
  | { status: "pending"; receipt?: JsonValue | undefined }
  | { status: "unknown"; receipt?: JsonValue | undefined };

export interface ActionRunOptions {
  identity?: InvocationIdentity | undefined;
  authorization?: AuthorizationDecision | undefined;
  signal?: AbortSignal | undefined;
}

export interface ActionRunner {
  run<I extends JsonValue, O extends JsonValue>(
    action: Action<I, O>,
    input: unknown,
    options?: ActionRunOptions,
  ): Promise<O>;
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
  readonly reconcile?:
    | ((input: I, context: ActionExecutionContext) => Promise<ReconcileResult<O>> | ReconcileResult<O>)
    | undefined;
  readonly cancel?:
    | ((input: I, context: ActionExecutionContext) => Promise<void> | void)
    | undefined;
  readonly receipt?: ((value: O, input: I) => JsonValue | undefined) | undefined;
  run(runtime: ActionRunner, input: unknown, options?: ActionRunOptions): Promise<O>;
}

export type ActionDefinition<I extends JsonValue, O extends JsonValue> = Omit<Action<I, O>, "run">;

export function defineAction<I extends JsonValue, O extends JsonValue>(
  definition: ActionDefinition<I, O>,
): Action<I, O> {
  if (!/^[a-z][a-z0-9_.-]*$/u.test(definition.name)) {
    throw new TypeError("Action name must be a stable lowercase identifier");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(definition.version)) {
    throw new TypeError("Action version must be a stable identifier");
  }
  if (definition.description.trim().length === 0) {
    throw new TypeError("Action description must not be empty");
  }
  assertEffectProfile(definition.effect);
  if (definition.effect.guarantee === "reconcilable" && definition.reconcile === undefined) {
    throw new TypeError("A reconcilable action must implement reconcile()");
  }
  if (definition.cancel !== undefined && !definition.effect.cancellable) {
    throw new TypeError("An Action with cancel() must declare a cancellable effect profile");
  }

  return Object.freeze({
    ...definition,
    effect: Object.freeze({ ...definition.effect }),
    run(runtime: ActionRunner, input: unknown, options?: ActionRunOptions): Promise<O> {
      return runtime.run(this, input, options);
    },
  });
}

function assertEffectProfile(effect: EffectProfile): void {
  const expected = {
    "read-only": { sideEffect: false, authorization: false, idempotency: "none" },
    guarded: { sideEffect: true, authorization: true, idempotency: "none" },
    idempotent: { sideEffect: true, authorization: true, idempotency: "operation-key" },
    reconcilable: { sideEffect: true, authorization: true, idempotency: effect.idempotency },
    unmanaged: { sideEffect: true, authorization: false, idempotency: "none" },
  } as const;
  const profile = expected[effect.guarantee];
  if (
    profile === undefined ||
    effect.hasExternalSideEffect !== profile.sideEffect ||
    effect.requiresAuthorization !== profile.authorization ||
    effect.idempotency !== profile.idempotency
  ) {
    throw new TypeError(`Inconsistent effect profile: ${effect.guarantee}`);
  }
}
