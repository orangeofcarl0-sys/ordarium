import {
  OrdariumRuntime,
  assertOperatorAuthorization,
  createOperations,
  operationIdentityPreview,
  projectModelView,
  type Action,
  type JsonValue,
  type OperationListFilter,
  type OperationView,
  type OperatorAuthorization,
} from "@ordarium/core";

import {
  asDshTool,
  createDshOrdarium,
  type CreateDshOrdariumOptions,
  type DshContentBlock,
  type DshOrdarium,
  type DshPluginContext,
  type DshToolDefinition,
  type DshToolRunContext,
} from "./advanced.js";

/**
 * The official Ordarium DSH plugin shell (G9 design spec): the process-level
 * owner of the shared Ordarium instance and the only piece of Ordarium that
 * ships as plugin functionality of its own - the operations plane. Action
 * authorship stays with business plugins; the shell never becomes a tool
 * registration framework.
 */

export interface OrdariumPluginOptions extends CreateDshOrdariumOptions {
  /**
   * Opt-in operations plane: registers the four ordarium_* tools under this
   * host-injected OperatorAuthorization and exposes plugin.ops in-process.
   * The shell is the trusted injection point the G4 boundary requires -
   * tool input can never fabricate it.
   */
  readonly operations?: { readonly authorization: OperatorAuthorization } | undefined;
}

export interface OrdariumPluginOps {
  inspect(operationId: string): Promise<OperationView | undefined>;
  list(
    filter?: OperationListFilter,
    cursor?: string,
  ): Promise<{ views: OperationView[]; nextCursor?: string }>;
  history(
    operationId: string,
    cursor?: string,
    limit?: number,
  ): Promise<{
    views: { semanticRevision: number; state: string; at: string; view: OperationView }[];
    nextCursor?: string;
  }>;
  reconcileOnly<I extends JsonValue, O extends JsonValue>(request: {
    action: Action<I, O>;
    input: unknown;
    identity: {
      source: string;
      scope: string;
      callId: string;
      rootCallId?: string | undefined;
    };
    signal?: AbortSignal | undefined;
  }): Promise<O>;
}

export interface OrdariumDshPlugin extends DshOrdarium {
  readonly ops?: OrdariumPluginOps | undefined;
  dispose(): Promise<void>;
}

function textBlocks(value: unknown): DshContentBlock[] {
  return [{ type: "text", text: JSON.stringify(value) }];
}

function opsTool(
  name: string,
  description: string,
  inputSchema: Record<string, unknown>,
  execute: (args: Record<string, unknown>, context: DshToolRunContext) => Promise<unknown>,
): DshToolDefinition<JsonValue, JsonValue> {
  return {
    name,
    description,
    parameters: {
      type: "object",
      properties: inputSchema as Record<string, JsonValue>,
      required: Object.keys(inputSchema),
      additionalProperties: false,
    },
    output: {
      schema: { type: "object" },
      render: (_args, value) => textBlocks(value),
    },
    execute: (args, context) => execute(args as Record<string, unknown>, context) as Promise<JsonValue>,
  };
}

export function createOrdariumPlugin(options: OrdariumPluginOptions = {}): OrdariumDshPlugin {
  const base = createDshOrdarium({
    databasePath: options.databasePath,
    runtime: options.runtime,
    authorize: options.authorize,
    scopeId: options.scopeId,
    ...(options.recoveryMaterial === undefined
      ? {}
      : { recoveryMaterial: options.recoveryMaterial }),
  });

  const registeredActions = new Map<string, Action<JsonValue, JsonValue>>();
  const authorization = options.operations?.authorization;
  if (authorization !== undefined) {
    // Construction-time gate (G9 spec section 2 rule 2): a forged or
    // malformed grant must fail before any tool is ever registered.
    assertOperatorAuthorization(authorization, "operations");
  }

  const baseTool = base.tool.bind(base);
  const baseRegister = base.register.bind(base);
  const baseClose = base.close.bind(base);

  const plugin: OrdariumDshPlugin = {
    ...base,
    tool(action, toolOptions = {}) {
      const definition = baseTool(action, toolOptions);
      registeredActions.set(action.name, action as unknown as Action<JsonValue, JsonValue>);
      return definition;
    },
    register(context: DshPluginContext, actions: readonly Action<JsonValue, JsonValue>[]) {
      const unregister = baseRegister(context, actions);
      for (const action of actions) {
        registeredActions.set(action.name, action as unknown as Action<JsonValue, JsonValue>);
      }
      const opsUnregister =
        authorization === undefined ? undefined : registerOperationsTools(context, plugin);
      return () => {
        unregister();
        opsUnregister?.();
      };
    },
    async close() {
      await baseClose();
    },
    async dispose() {
      await baseClose();
    },
  };

  if (authorization === undefined) {
    return plugin;
  }

  const operations = createOperations({ runtime: base.runtime });
  const ops: OrdariumPluginOps = {
    inspect: (operationId) => operations.inspect(operationId, authorization),
    list: async (filter, cursor) => {
      const page = await operations.list(filter, cursor, authorization);
      return { views: [...page.views], ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }) };
    },
    history: async (operationId, cursor, limit) => {
      const page = await operations.history(operationId, cursor, limit, authorization);
      return {
        views: page.events.map((event) => ({
          semanticRevision: event.semanticRevision,
          state: event.state,
          at: event.at,
          view: event.view,
        })),
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      };
    },
    reconcileOnly: (request) => {
      const preview = operationIdentityPreview(request.action, request.input, {
        source: request.identity.source,
        scope: request.identity.scope,
        callId: request.identity.callId,
        ...(request.identity.rootCallId === undefined ? {} : { rootCallId: request.identity.rootCallId }),
      });
      return operations.reconcileOnly({
        operationId: preview.operationId,
        action: request.action,
        input: request.input,
        identity: request.identity,
        authorization,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });
    },
  };
  (plugin as { ops?: OrdariumPluginOps }).ops = ops;

  return plugin;

  function registerOperationsTools(
    context: DshPluginContext,
    owner: OrdariumDshPlugin,
  ): () => void {
    const tools: DshToolDefinition<JsonValue, JsonValue>[] = [];

    tools.push(opsTool(
      "ordarium_inspect",
      "Inspect one Ordarium operation (sanitized model view)",
      { operationId: { type: "string" } },
      async (args) => {
        const record = await base.runtime.ledger.get(String(args.operationId));
        return record === undefined
          ? { found: false }
          : { found: true, view: projectModelView(record) };
      },
    ));

    tools.push(opsTool(
      "ordarium_list",
      "List Ordarium operations with bounded cursor pagination (sanitized model views)",
      {
        actionName: { type: "string" },
        cursor: { type: "string" },
        limit: { type: "number" },
      },
      async (args) => {
        const filter: OperationListFilter = {};
        if (typeof args.actionName === "string") filter.actionName = args.actionName;
        if (typeof args.limit === "number") filter.limit = Math.max(0, Math.floor(args.limit));
        const cursor = typeof args.cursor === "string" && args.cursor.length > 0
          ? args.cursor
          : undefined;
        const page = await base.runtime.ledger.list(filter, cursor);
        return {
          views: page.records.map(projectModelView),
          ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
        };
      },
    ));

    tools.push(opsTool(
      "ordarium_history",
      "Read the semantic revision history of one Ordarium operation (sanitized)",
      {
        operationId: { type: "string" },
        cursor: { type: "string" },
        limit: { type: "number" },
      },
      async (args) => {
        const cursor = typeof args.cursor === "string" && args.cursor.length > 0
          ? args.cursor
          : undefined;
        const limit = typeof args.limit === "number" ? Math.max(0, Math.floor(args.limit)) : undefined;
        const page = await base.runtime.ledger.history(String(args.operationId), cursor, limit);
        return {
          events: page.events.map((event) => ({
            semanticRevision: event.semanticRevision,
            state: event.state,
            at: event.at,
            view: projectModelView(event.record),
          })),
          ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
        };
      },
    ));

    tools.push(opsTool(
      "ordarium_reconcile",
      "Query-only recovery for an uncertain operation; the caller resubmits the original action input and identity",
      {
        actionName: { type: "string" },
        input: {},
        source: { type: "string" },
        scope: { type: "string" },
        callId: { type: "string" },
      },
      async (args) => {
        const action = registeredActions.get(String(args.actionName));
        if (action === undefined) {
          return { error: "OPERATION_CONFLICT", detail: "unknown action for this plugin" };
        }
        try {
          const value = await owner.ops!.reconcileOnly({
            action,
            input: args.input,
            identity: {
              source: String(args.source),
              scope: String(args.scope),
              callId: String(args.callId),
            },
          });
          return { resolved: value as JsonValue };
        } catch (error) {
          const code = (error as { code?: string }).code;
          if (typeof code === "string") return { error: code };
          return { error: "OPERATION_UNCERTAIN" };
        }
      },
    ));

    const disposers: (() => void)[] = [];
    for (const tool of tools) {
      const registered = context.tools.register(tool);
      if (typeof registered === "function") disposers.push(registered);
      else if (registered !== undefined) disposers.push(() => registered.dispose());
    }
    return () => {
      for (const dispose of [...disposers].reverse()) dispose();
    };
  }
}
