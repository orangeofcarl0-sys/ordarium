import { OrdariumRuntime, type Action, type AuthorizationDecision, type JsonObject, type JsonValue, type ProviderPrincipalRef } from "@ordarium/core";
/**
 * @deprecated Legacy DSH adapter leaf (frozen 2026-09-11, see COMPAT-DSH-002 in
 * evidence/compatibility-register.md). It receives no new capability and is not the
 * recommended integration path: use `@ordarium/core` with `@ordarium/host-kit`
 * (custom host) or `@ordarium/host-mcp` (MCP) instead.
 */
export interface DshTextContent {
    type: "text";
    text: string;
}
/**
 * Structural content block (G5 design spec §1): the default renderer emits
 * text blocks, but custom renderers may return any host-native block shape
 * - the adapter no longer restricts them to a private text-only union
 * (COMPAT-DSH-001).
 *
 * @deprecated Legacy DSH adapter leaf (frozen 2026-09-11, see COMPAT-DSH-002 in
 * evidence/compatibility-register.md). It receives no new capability and is not the
 * recommended integration path: use `@ordarium/core` with `@ordarium/host-kit`
 * (custom host) or `@ordarium/host-mcp` (MCP) instead.
 */
export type DshContentBlock = {
    readonly type: string;
} & Record<string, unknown>;
/**
 * @deprecated Legacy DSH adapter leaf (frozen 2026-09-11, see COMPAT-DSH-002 in
 * evidence/compatibility-register.md). It receives no new capability and is not the
 * recommended integration path: use `@ordarium/core` with `@ordarium/host-kit`
 * (custom host) or `@ordarium/host-mcp` (MCP) instead.
 */
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
/**
 * @deprecated Legacy DSH adapter leaf (frozen 2026-09-11, see COMPAT-DSH-002 in
 * evidence/compatibility-register.md). It receives no new capability and is not the
 * recommended integration path: use `@ordarium/core` with `@ordarium/host-kit`
 * (custom host) or `@ordarium/host-mcp` (MCP) instead.
 */
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
/**
 * @deprecated Legacy DSH adapter leaf (frozen 2026-09-11, see COMPAT-DSH-002 in
 * evidence/compatibility-register.md). It receives no new capability and is not the
 * recommended integration path: use `@ordarium/core` with `@ordarium/host-kit`
 * (custom host) or `@ordarium/host-mcp` (MCP) instead.
 */
export interface DshToolRegistry {
    register(definition: DshToolDefinition<JsonValue, JsonValue>): void | (() => void) | {
        dispose(): void;
    };
}
/**
 * @deprecated Legacy DSH adapter leaf (frozen 2026-09-11, see COMPAT-DSH-002 in
 * evidence/compatibility-register.md). It receives no new capability and is not the
 * recommended integration path: use `@ordarium/core` with `@ordarium/host-kit`
 * (custom host) or `@ordarium/host-mcp` (MCP) instead.
 */
export interface DshPluginContext {
    tools: DshToolRegistry;
}
/**
 * @deprecated Legacy DSH adapter leaf (frozen 2026-09-11, see COMPAT-DSH-002 in
 * evidence/compatibility-register.md). It receives no new capability and is not the
 * recommended integration path: use `@ordarium/core` with `@ordarium/host-kit`
 * (custom host) or `@ordarium/host-mcp` (MCP) instead.
 */
export interface DshAuthorizationRequest<I extends JsonValue, O extends JsonValue> {
    action: Action<I, O>;
    input: I;
    context: DshToolRunContext;
}
/**
 * @deprecated Legacy DSH adapter leaf (frozen 2026-09-11, see COMPAT-DSH-002 in
 * evidence/compatibility-register.md). It receives no new capability and is not the
 * recommended integration path: use `@ordarium/core` with `@ordarium/host-kit`
 * (custom host) or `@ordarium/host-mcp` (MCP) instead.
 */
export type DshAuthorizer = <I extends JsonValue, O extends JsonValue>(request: DshAuthorizationRequest<I, O>) => Promise<AuthorizationDecision> | AuthorizationDecision;
/**
 * @deprecated Legacy DSH adapter leaf (frozen 2026-09-11, see COMPAT-DSH-002 in
 * evidence/compatibility-register.md). It receives no new capability and is not the
 * recommended integration path: use `@ordarium/core` with `@ordarium/host-kit`
 * (custom host) or `@ordarium/host-mcp` (MCP) instead.
 */
export interface DshActionOptions<I extends JsonValue, O extends JsonValue> {
    runtime: OrdariumRuntime;
    authorize?: DshAuthorizer | undefined;
    scopeId?: string | ((context: DshToolRunContext) => string) | undefined;
    actor?: ((context: DshToolRunContext) => string | undefined) | undefined;
    lineage?: ((context: DshToolRunContext) => string[] | undefined) | undefined;
    /** Transient provider principal resolved from host context (digest-only persistence). */
    providerPrincipalRef?: ((context: DshToolRunContext) => ProviderPrincipalRef | undefined) | undefined;
    render?: ((input: I, value: O) => DshContentBlock[]) | undefined;
    timeoutMs?: number | undefined;
    isConcurrencySafe?: ((input: I) => boolean) | undefined;
}
type AnyAction = Action<any, any>;
/**
 * @deprecated Legacy DSH adapter leaf (frozen 2026-09-11, see COMPAT-DSH-002 in
 * evidence/compatibility-register.md). It receives no new capability and is not the
 * recommended integration path: use `@ordarium/core` with `@ordarium/host-kit`
 * (custom host) or `@ordarium/host-mcp` (MCP) instead.
 */
export declare function asDshTool<I extends JsonValue, O extends JsonValue>(action: Action<I, O>, options: DshActionOptions<I, O>): DshToolDefinition<I, O>;
/**
 * @deprecated Legacy DSH adapter leaf (frozen 2026-09-11, see COMPAT-DSH-002 in
 * evidence/compatibility-register.md). It receives no new capability and is not the
 * recommended integration path: use `@ordarium/core` with `@ordarium/host-kit`
 * (custom host) or `@ordarium/host-mcp` (MCP) instead.
 */
export interface RegisterActionsOptions {
    runtime: OrdariumRuntime;
    authorize?: DshAuthorizer | undefined;
    scopeId?: string | ((context: DshToolRunContext) => string) | undefined;
}
/**
 * @deprecated Legacy DSH adapter leaf (frozen 2026-09-11, see COMPAT-DSH-002 in
 * evidence/compatibility-register.md). It receives no new capability and is not the
 * recommended integration path: use `@ordarium/core` with `@ordarium/host-kit`
 * (custom host) or `@ordarium/host-mcp` (MCP) instead.
 */
export declare function registerActions(context: DshPluginContext, actions: readonly AnyAction[], options: RegisterActionsOptions): () => void;
/**
 * Session recovery material binding (G5 design spec §3, source priority 1):
 * the host resolves the original invocation arguments by identity so G4's
 * reconcileOnly can verify them against the durable digests.
 *
 * @deprecated Legacy DSH adapter leaf (frozen 2026-09-11, see COMPAT-DSH-002 in
 * evidence/compatibility-register.md). It receives no new capability and is not the
 * recommended integration path: use `@ordarium/core` with `@ordarium/host-kit`
 * (custom host) or `@ordarium/host-mcp` (MCP) instead.
 */
export type DshRecoveryMaterialResolver = (invocation: {
    source: string;
    scope: string;
    callId: string;
}) => Promise<unknown | undefined> | unknown | undefined;
/**
 * @deprecated Legacy DSH adapter leaf (frozen 2026-09-11, see COMPAT-DSH-002 in
 * evidence/compatibility-register.md). It receives no new capability and is not the
 * recommended integration path: use `@ordarium/core` with `@ordarium/host-kit`
 * (custom host) or `@ordarium/host-mcp` (MCP) instead.
 */
export interface CreateDshOrdariumOptions {
    databasePath?: string | undefined;
    runtime?: OrdariumRuntime | undefined;
    authorize?: DshAuthorizer | undefined;
    scopeId?: string | ((context: DshToolRunContext) => string) | undefined;
    recoveryMaterial?: DshRecoveryMaterialResolver | undefined;
}
/**
 * @deprecated Legacy DSH adapter leaf (frozen 2026-09-11, see COMPAT-DSH-002 in
 * evidence/compatibility-register.md). It receives no new capability and is not the
 * recommended integration path: use `@ordarium/core` with `@ordarium/host-kit`
 * (custom host) or `@ordarium/host-mcp` (MCP) instead.
 */
export interface DshOrdarium {
    readonly runtime: OrdariumRuntime;
    readonly databasePath?: string | undefined;
    readonly recoveryMaterial?: DshRecoveryMaterialResolver | undefined;
    tool<I extends JsonValue, O extends JsonValue>(action: Action<I, O>, options?: Omit<DshActionOptions<I, O>, "authorize" | "runtime" | "scopeId">): DshToolDefinition<I, O>;
    register(context: DshPluginContext, actions: readonly AnyAction[]): () => void;
    close(): Promise<void>;
}
/**
 * @deprecated Legacy DSH adapter leaf (frozen 2026-09-11, see COMPAT-DSH-002 in
 * evidence/compatibility-register.md). It receives no new capability and is not the
 * recommended integration path: use `@ordarium/core` with `@ordarium/host-kit`
 * (custom host) or `@ordarium/host-mcp` (MCP) instead.
 */
export declare function createDshOrdarium(options?: CreateDshOrdariumOptions): DshOrdarium;
/**
 * @deprecated Legacy DSH adapter leaf (frozen 2026-09-11, see COMPAT-DSH-002 in
 * evidence/compatibility-register.md). It receives no new capability and is not the
 * recommended integration path: use `@ordarium/core` with `@ordarium/host-kit`
 * (custom host) or `@ordarium/host-mcp` (MCP) instead.
 */
export declare function defaultDatabasePath(): string;
/**
 * @deprecated Legacy DSH adapter leaf (frozen 2026-09-11, see COMPAT-DSH-002 in
 * evidence/compatibility-register.md). It receives no new capability and is not the
 * recommended integration path: use `@ordarium/core` with `@ordarium/host-kit`
 * (custom host) or `@ordarium/host-mcp` (MCP) instead.
 */
export { createOrdariumPlugin } from "./plugin.js";
/**
 * @deprecated Legacy DSH adapter leaf (frozen 2026-09-11, see COMPAT-DSH-002 in
 * evidence/compatibility-register.md). It receives no new capability and is not the
 * recommended integration path: use `@ordarium/core` with `@ordarium/host-kit`
 * (custom host) or `@ordarium/host-mcp` (MCP) instead.
 */
export type { OrdariumPluginOptions, OrdariumPluginOps, OrdariumDshPlugin } from "./plugin.js";
/**
 * Management state surface (G11 design spec §2): the state kind stays behind
 * /advanced - the root façade keeps its author golden path and never grows a
 * state surface. Palimpsest-style hosts construct the store over the shared
 * runtime they already consume.
 *
 * @deprecated Legacy DSH adapter leaf (frozen 2026-09-11, see COMPAT-DSH-002 in
 * evidence/compatibility-register.md). It receives no new capability and is not the
 * recommended integration path: use `@ordarium/core` with `@ordarium/host-kit`
 * (custom host) or `@ordarium/host-mcp` (MCP) instead.
 */
export { createStateStore } from "@ordarium/core";
/**
 * @deprecated Legacy DSH adapter leaf (frozen 2026-09-11, see COMPAT-DSH-002 in
 * evidence/compatibility-register.md). It receives no new capability and is not the
 * recommended integration path: use `@ordarium/core` with `@ordarium/host-kit`
 * (custom host) or `@ordarium/host-mcp` (MCP) instead.
 */
export type { CreateStateStoreOptions, OrdariumStateStore, StateListFilter, StateRecord, StateRecordPage, StateRef, StateRevisionPage, StateWriteRequest, } from "@ordarium/core";
//# sourceMappingURL=advanced.d.ts.map