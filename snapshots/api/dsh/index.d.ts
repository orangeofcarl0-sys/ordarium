import { OrdariumRuntime, type Action, type AuthorizationDecision, type JsonObject, type JsonValue } from "@ordarium/core";
export * from "@ordarium/core";
export { SqliteLedger } from "@ordarium/ledger-sqlite";
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
    register(definition: DshToolDefinition<JsonValue, JsonValue>): void | (() => void) | {
        dispose(): void;
    };
}
export interface DshPluginContext {
    tools: DshToolRegistry;
}
export interface DshAuthorizationRequest<I extends JsonValue, O extends JsonValue> {
    action: Action<I, O>;
    input: I;
    context: DshToolRunContext;
}
export type DshAuthorizer = <I extends JsonValue, O extends JsonValue>(request: DshAuthorizationRequest<I, O>) => Promise<AuthorizationDecision> | AuthorizationDecision;
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
export declare function asDshTool<I extends JsonValue, O extends JsonValue>(action: Action<I, O>, options: DshActionOptions<I, O>): DshToolDefinition<I, O>;
export interface RegisterActionsOptions {
    runtime: OrdariumRuntime;
    authorize?: DshAuthorizer | undefined;
    scopeId?: string | ((context: DshToolRunContext) => string) | undefined;
}
export declare function registerActions(context: DshPluginContext, actions: readonly AnyAction[], options: RegisterActionsOptions): () => void;
export interface CreateDshOrdariumOptions {
    databasePath?: string | undefined;
    runtime?: OrdariumRuntime | undefined;
    authorize?: DshAuthorizer | undefined;
    scopeId?: string | ((context: DshToolRunContext) => string) | undefined;
}
export interface DshOrdarium {
    readonly runtime: OrdariumRuntime;
    readonly databasePath?: string | undefined;
    tool<I extends JsonValue, O extends JsonValue>(action: Action<I, O>, options?: Omit<DshActionOptions<I, O>, "authorize" | "runtime" | "scopeId">): DshToolDefinition<I, O>;
    register(context: DshPluginContext, actions: readonly AnyAction[]): () => void;
    close(): Promise<void>;
}
export declare function createDshOrdarium(options?: CreateDshOrdariumOptions): DshOrdarium;
export interface InstallOrdariumOptions extends CreateDshOrdariumOptions {
    actions: readonly AnyAction[];
}
export declare function installOrdarium(context: DshPluginContext, options: InstallOrdariumOptions): DshOrdarium & {
    dispose(): Promise<void>;
};
export declare function defaultDatabasePath(): string;
//# sourceMappingURL=index.d.ts.map