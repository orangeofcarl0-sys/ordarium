import { createInterface } from "node:readline";

import {
  OrdariumError,
  OrdariumRuntime,
  projectModelView,
  requiresAuthorization,
  type Action,
  type AuthorizationDecision,
  type JsonObject,
  type JsonValue,
  type OperatorAuthorization,
  type ProviderPrincipalRef,
} from "@ordarium/core";
import { SqliteLedger } from "@ordarium/ledger-sqlite";

/**
 * @ordarium/host-mcp - the real second host (G5 design spec §4).
 *
 * A Model Context Protocol server over stdio that maps tools/list and
 * tools/call onto HostInvocationPort invocations. The MCP protocol surface
 * (a JSON-RPC 2.0 subset) lives entirely in this leaf package; the kernel
 * stays free of host types and host SDKs.
 */

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "ordarium", version: "0.2.0" } as const;

export interface McpAuthorizationRequest {
  readonly action: Action<JsonValue, JsonValue>;
  readonly input: unknown;
  readonly toolName: string;
}

export type McpAuthorizer = (
  request: McpAuthorizationRequest,
) => Promise<AuthorizationDecision> | AuthorizationDecision;

export interface McpOrdariumOptions {
  readonly actions: readonly Action<JsonValue, JsonValue>[];
  readonly databasePath?: string | undefined;
  readonly runtime?: OrdariumRuntime | undefined;
  readonly authorize?: McpAuthorizer | undefined;
  readonly providerPrincipalRef?:
    | ((toolName: string) => ProviderPrincipalRef | undefined)
    | undefined;
  /**
   * Opt-in operations surface (G5-A09): when provided, an
   * ordarium_inspect tool is registered under this operator authorization.
   * It is never exposed by default and model input cannot grant it.
   */
  readonly operations?: { readonly authorization: OperatorAuthorization } | undefined;
}

export interface McpOrdarium {
  readonly runtime: OrdariumRuntime;
  /** Handle one decoded JSON-RPC message; undefined means "no response". */
  handle(request: unknown): Promise<unknown | undefined>;
  /** Run the newline-delimited stdio loop until stdin ends or stop(). */
  start(stdio?: { stdin: NodeJS.ReadableStream; stdout: NodeJS.WritableStream }): Promise<void>;
  stop(): Promise<void>;
}

type AnyAction = Action<JsonValue, JsonValue>;

export function createMcpOrdarium(options: McpOrdariumOptions): McpOrdarium {
  const databasePath = options.runtime === undefined
    ? options.databasePath ?? undefined
    : undefined;
  const runtime = options.runtime ?? new OrdariumRuntime({
    ledger: databasePath === undefined
      ? new SqliteLedger(":memory:")
      : new SqliteLedger(databasePath),
    deploymentCoordination: "local-multi-process",
  });
  const byName = new Map<string, AnyAction>(
    options.actions.map((action) => [action.name, action as AnyAction]),
  );
  let clientScope = "mcp-client";
  const inspectAuthz = options.operations?.authorization;

  const toolDefinitions = () => {
    const tools = [...byName.values()].map((action) => ({
      name: action.name,
      description: action.description,
      inputSchema: action.input.jsonSchema,
    }));
    if (inspectAuthz !== undefined) {
      tools.push({
        name: "ordarium_inspect",
        description: "Inspect one operation (operator audit view, sanitized)",
        inputSchema: {
          type: "object",
          properties: { operationId: { type: "string" } },
          required: ["operationId"],
          additionalProperties: false,
        } as JsonObject,
      });
    }
    return tools;
  };

  const callAction = async (name: string, rawArguments: unknown, callId: string) => {
    if (name === "ordarium_inspect") {
      if (inspectAuthz === undefined) {
        return errorResult("OPERATOR_AUTHORIZATION_REQUIRED: operations tools are not registered");
      }
      const operationId = (rawArguments as { operationId?: unknown })?.operationId;
      if (typeof operationId !== "string") {
        return errorResult("Invalid params: operationId is required");
      }
      const record = await runtime.ledger.get(operationId);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(record === undefined ? { found: false } : { found: true, view: projectModelView(record) }),
        }],
        isError: false,
      };
    }
    const action = byName.get(name);
    if (action === undefined) {
      return errorResult(`Unknown tool: ${name}`);
    }
    const authorization = requiresAuthorization(action.effect)
      ? await (options.authorize?.({ action: action as AnyAction, input: rawArguments, toolName: name }) ?? {
          decision: "allow",
          kind: "host-admission",
          source: "mcp:tool-body-admitted",
          reason: "The MCP client submitted a tool call; this is not evidence of human approval",
        })
      : undefined;
    const principal = options.providerPrincipalRef?.(name);
    try {
      const result = await runtime.run(action, rawArguments, {
        identity: { source: "mcp", scope: clientScope, callId },
        ...(authorization === undefined ? {} : { authorization }),
        ...(principal === undefined ? {} : { providerPrincipalRef: principal }),
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }], isError: false };
    } catch (error) {
      if (error instanceof OrdariumError) {
        return errorResult(`${error.code}: ${error.message}`);
      }
      return errorResult("ACTION_FAILED: The tool failed");
    }
  };

  const handle = async (request: unknown): Promise<unknown | undefined> => {
    if (request === null || typeof request !== "object") return undefined;
    const message = request as {
      jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown;
    };
    if (message.method === undefined || typeof message.method !== "string") return undefined;
    const isNotification = message.id === undefined;
    const respond = (result: unknown, error?: unknown): unknown => ({
      jsonrpc: "2.0",
      ...(message.id === undefined ? {} : { id: message.id }),
      ...(error === undefined ? { result } : { error }),
    });

    switch (message.method) {
      case "initialize": {
        const params = message.params as { clientInfo?: { name?: unknown } } | undefined;
        const clientName = params?.clientInfo?.name;
        if (typeof clientName === "string" && clientName.length > 0) {
          clientScope = clientName.slice(0, 256);
        }
        return respond({
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });
      }
      case "notifications/initialized":
        return undefined;
      case "ping":
        return respond({});
      case "tools/list":
        return respond({ tools: toolDefinitions() });
      case "tools/call": {
        const params = message.params as
          | { name?: unknown; arguments?: unknown }
          | undefined;
        const name = params?.name;
        if (typeof name !== "string" || isNotification) {
          return isNotification ? undefined : respond(undefined, {
            code: -32602, message: "Invalid params",
          });
        }
        const callId = String(message.id ?? `call-${name}`);
        const result = await callAction(name, params?.arguments ?? {}, callId);
        return respond(result);
      }
      default:
        return isNotification ? undefined : respond(undefined, {
          code: -32601, message: `Method not found: ${message.method}`,
        });
    }
  };

  let stopping = false;
  let stopped = () => {};
  const didStop = new Promise<void>((resolve) => {
    stopped = resolve;
  });

  return {
    runtime,
    handle,
    async start(stdio) {
      const input = stdio?.stdin ?? process.stdin;
      const output = stdio?.stdout ?? process.stdout;
      const lines = createInterface({ input });
      const closed = new Promise<void>((resolve) => {
        lines.on("close", resolve);
      });
      lines.on("line", (line) => {
        void (async () => {
          if (stopping || line.trim().length === 0) return;
          let request: unknown;
          try {
            request = JSON.parse(line);
          } catch {
            return;
          }
          const response = await handle(request);
          if (response !== undefined) {
            output.write(`${JSON.stringify(response)}\n`);
          }
        })();
      });
      await Promise.race([closed, didStop]);
      lines.close();
      await runtime.dispose();
    },
    async stop() {
      stopping = true;
      stopped();
    },
  };

  function errorResult(text: string): { content: { type: "text"; text: string }[]; isError: boolean } {
    return { content: [{ type: "text", text }], isError: true };
  }
}
