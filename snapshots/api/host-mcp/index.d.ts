import { OrdariumRuntime, type Action, type AuthorizationDecision, type JsonValue, type OperatorAuthorization, type ProviderPrincipalRef } from "@ordarium/core";
export interface McpAuthorizationRequest {
    readonly action: Action<JsonValue, JsonValue>;
    readonly input: unknown;
    readonly toolName: string;
}
export type McpAuthorizer = (request: McpAuthorizationRequest) => Promise<AuthorizationDecision> | AuthorizationDecision;
export interface McpOrdariumOptions {
    readonly actions: readonly Action<JsonValue, JsonValue>[];
    readonly databasePath?: string | undefined;
    readonly runtime?: OrdariumRuntime | undefined;
    readonly authorize?: McpAuthorizer | undefined;
    readonly providerPrincipalRef?: ((toolName: string) => ProviderPrincipalRef | undefined) | undefined;
    /**
     * Opt-in operations surface (G5-A09): when provided, an
     * ordarium_inspect tool is registered under this operator authorization.
     * It is never exposed by default and model input cannot grant it.
     */
    readonly operations?: {
        readonly authorization: OperatorAuthorization;
    } | undefined;
}
export interface McpOrdarium {
    readonly runtime: OrdariumRuntime;
    /** Handle one decoded JSON-RPC message; undefined means "no response". */
    handle(request: unknown): Promise<unknown | undefined>;
    /** Run the newline-delimited stdio loop until stdin ends or stop(). */
    start(stdio?: {
        stdin: NodeJS.ReadableStream;
        stdout: NodeJS.WritableStream;
    }): Promise<void>;
    stop(): Promise<void>;
}
export declare function createMcpOrdarium(options: McpOrdariumOptions): McpOrdarium;
//# sourceMappingURL=index.d.ts.map