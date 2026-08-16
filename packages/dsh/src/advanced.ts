import { homedir } from "node:os";
import { join } from "node:path";

import {
  OrdariumRuntime,
  requiresAuthorization,
  type Action,
  type AuthorizationDecision,
  type HostInvocation,
  type InvocationIdentity,
  type JsonObject,
  type JsonValue,
} from "@ordarium/core";
import { SqliteLedger } from "@ordarium/ledger-sqlite";

export interface DshTextContent {
  type: "text";
  text: string;
}

export type DshContentBlock = DshTextContent;

export interface DshToolRunContext {
  readonly callId: string;
  readonly rootCallId: string;
  readonly name: string;
  readonly arguments: unknown;
  readonly agent?: unknown;
  readonly parent?: unknown;
  readonly signal: AbortSignal;
  deferContext?(context: unknown): void;
  concludeTurn?(): void;
}

export interface DshToolDefinition<I extends JsonValue, O extends JsonValue> {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonObject;
  readonly output: {
    readonly schema: JsonObject;
    render(args: unknown, value: JsonValue): DshContentBlock[];
  };
  readonly timeoutMs?: number | undefined;
  isConcurrencySafe?(args: unknown): boolean;
  execute(args: I, context: DshToolRunContext): Promise<O>;
}

export interface DshToolRegistry {
  register(definition: DshToolDefinition<JsonValue, JsonValue>):
    | void
    | (() => void)
    | { dispose(): void };
}

export interface DshPluginContext {
  tools: DshToolRegistry;
}

export interface DshAuthorizationRequest<I extends JsonValue, O extends JsonValue> {
  action: Action<I, O>;
  input: I;
  context: DshToolRunContext;
}

export type DshAuthorizer = <I extends JsonValue, O extends JsonValue>(
  request: DshAuthorizationRequest<I, O>,
) => Promise<AuthorizationDecision> | AuthorizationDecision;

export interface DshActionOptions<I extends JsonValue, O extends JsonValue> {
  runtime: OrdariumRuntime;
  authorize?: DshAuthorizer | undefined;
  scopeId?: string | ((context: DshToolRunContext) => string) | undefined;
  actor?: ((context: DshToolRunContext) => string | undefined) | undefined;
  lineage?: ((context: DshToolRunContext) => string[] | undefined) | undefined;
  render?: ((input: I, value: O) => DshContentBlock[]) | undefined;
  timeoutMs?: number | undefined;
  isConcurrencySafe?: ((input: I) => boolean) | undefined;
}

type AnyAction = Action<any, any>;

export function asDshTool<I extends JsonValue, O extends JsonValue>(
  action: Action<I, O>,
  options: DshActionOptions<I, O>,
): DshToolDefinition<I, O> {
  if (action.input.jsonSchema.type !== "object") {
    throw new TypeError("DSH Action input must use an object JSON Schema");
  }
  const concurrency = options.isConcurrencySafe;
  const timeout = options.timeoutMs;
  return {
    name: action.name,
    description: action.description,
    parameters: action.input.jsonSchema,
    output: {
      schema: action.output.jsonSchema,
      render(args, value) {
        const input = action.input.parse(args);
        const output = action.output.parse(value);
        return options.render?.(input, output) ?? [{ type: "text", text: renderJson(output) }];
      },
    },
    ...(timeout === undefined ? {} : { timeoutMs: timeout }),
    ...(concurrency === undefined
      ? {}
      : {
          isConcurrencySafe(args: unknown): boolean {
            return concurrency(action.input.parse(args));
          },
        }),
    async execute(args, context) {
      const input = action.input.parse(args);
      const identity = identityFromDsh(context, options);
      const authorization = requiresAuthorization(action.effect)
        ? await (options.authorize?.({ action, input, context }) ?? {
            decision: "allow",
            kind: "host-admission",
            source: "dsh:tool-body-admitted",
            reason: "DSH admitted the tool body; this is not evidence of explicit human approval",
          })
        : undefined;
      const invocation: HostInvocation = {
        identity,
        signal: context.signal,
        ...(authorization === undefined ? {} : { authorization }),
      };
      return action.run(options.runtime, input, invocation);
    },
  };
}

export interface RegisterActionsOptions {
  runtime: OrdariumRuntime;
  authorize?: DshAuthorizer | undefined;
  scopeId?: string | ((context: DshToolRunContext) => string) | undefined;
}

export function registerActions(
  context: DshPluginContext,
  actions: readonly AnyAction[],
  options: RegisterActionsOptions,
): () => void {
  const disposers: (() => void)[] = [];
  let active = true;
  for (const action of actions) {
    const registered = context.tools.register(asDshTool(action, {
      runtime: options.runtime,
      ...(options.authorize === undefined ? {} : { authorize: options.authorize }),
      ...(options.scopeId === undefined ? {} : { scopeId: options.scopeId }),
    }));
    if (typeof registered === "function") {
      disposers.push(registered);
    } else if (registered !== undefined) {
      disposers.push(() => registered.dispose());
    }
  }
  return () => {
    if (!active) return;
    active = false;
    for (const dispose of [...disposers].reverse()) {
      dispose();
    }
  };
}

export interface CreateDshOrdariumOptions {
  databasePath?: string | undefined;
  runtime?: OrdariumRuntime | undefined;
  authorize?: DshAuthorizer | undefined;
  scopeId?: string | ((context: DshToolRunContext) => string) | undefined;
}

export interface DshOrdarium {
  readonly runtime: OrdariumRuntime;
  readonly databasePath?: string | undefined;
  tool<I extends JsonValue, O extends JsonValue>(
    action: Action<I, O>,
    options?: Omit<DshActionOptions<I, O>, "authorize" | "runtime" | "scopeId">,
  ): DshToolDefinition<I, O>;
  register(context: DshPluginContext, actions: readonly AnyAction[]): () => void;
  close(): Promise<void>;
}

export function createDshOrdarium(options: CreateDshOrdariumOptions = {}): DshOrdarium {
  const databasePath = options.runtime === undefined
    ? options.databasePath ?? defaultDatabasePath()
    : undefined;
  const runtime = options.runtime ?? new OrdariumRuntime({
    ledger: new SqliteLedger(databasePath as string),
    deploymentCoordination: "local-multi-process",
  });

  return {
    runtime,
    databasePath,
    tool(action, toolOptions = {}) {
      return asDshTool(action, {
        runtime,
        ...(options.authorize === undefined ? {} : { authorize: options.authorize }),
        ...(options.scopeId === undefined ? {} : { scopeId: options.scopeId }),
        ...toolOptions,
      });
    },
    register(context, actions) {
      return registerActions(context, actions, {
        runtime,
        ...(options.authorize === undefined ? {} : { authorize: options.authorize }),
        ...(options.scopeId === undefined ? {} : { scopeId: options.scopeId }),
      });
    },
    async close() {
      await runtime.close();
    },
  };
}

export function defaultDatabasePath(): string {
  const configured = process.env.DSH_HOME?.trim();
  const dshHome = configured === undefined || configured.length === 0
    ? join(homedir(), ".dsh")
    : configured;
  return join(dshHome, "ordarium", "operations.sqlite");
}

function identityFromDsh<I extends JsonValue, O extends JsonValue>(
  context: DshToolRunContext,
  options: DshActionOptions<I, O>,
): InvocationIdentity {
  const configuredScope = typeof options.scopeId === "function"
    ? options.scopeId(context)
    : options.scopeId;
  const scope = configuredScope ?? findAgentScope(context.agent) ?? "dsh";
  const actor = options.actor?.(context);
  const lineage = options.lineage?.(context);
  return {
    source: "dsh",
    scope,
    callId: String(context.callId),
    rootCallId: String(context.rootCallId),
    ...(actor === undefined ? {} : { actor }),
    ...(lineage === undefined ? {} : { lineage }),
  };
}

function findAgentScope(agent: unknown): string | undefined {
  if (agent === null || typeof agent !== "object") {
    return undefined;
  }
  const record = agent as Record<string, unknown>;
  const session = record.session;
  if (session !== null && typeof session === "object") {
    const sessionId = (session as Record<string, unknown>).id;
    if (typeof sessionId === "string" && sessionId.length > 0) {
      return sessionId;
    }
  }
  return typeof record.id === "string" && record.id.length > 0 ? record.id : undefined;
}

function renderJson(value: JsonValue): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
