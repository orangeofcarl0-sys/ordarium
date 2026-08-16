import { type Action, type JsonValue, type OperationListFilter, type OperationView, type OperatorAuthorization } from "@ordarium/core";
import { type CreateDshOrdariumOptions, type DshOrdarium } from "./advanced.js";
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
    readonly operations?: {
        readonly authorization: OperatorAuthorization;
    } | undefined;
}
export interface OrdariumPluginOps {
    inspect(operationId: string): Promise<OperationView | undefined>;
    list(filter?: OperationListFilter, cursor?: string): Promise<{
        views: OperationView[];
        nextCursor?: string;
    }>;
    history(operationId: string, cursor?: string, limit?: number): Promise<{
        views: {
            semanticRevision: number;
            state: string;
            at: string;
            view: OperationView;
        }[];
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
export declare function createOrdariumPlugin(options?: OrdariumPluginOptions): OrdariumDshPlugin;
//# sourceMappingURL=plugin.d.ts.map