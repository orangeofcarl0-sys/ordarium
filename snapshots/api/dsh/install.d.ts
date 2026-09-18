import type { Action } from "@ordarium/core";
import { type CreateDshOrdariumOptions, type DshOrdarium, type DshPluginContext } from "./advanced.js";
/**
 * @deprecated Legacy DSH adapter leaf (frozen 2026-09-11, see COMPAT-DSH-002 in
 * evidence/compatibility-register.md). It receives no new capability and is not the
 * recommended integration path: use `@ordarium/core` with `@ordarium/host-kit`
 * (custom host) or `@ordarium/host-mcp` (MCP) instead.
 */
export type { CreateDshOrdariumOptions, DshOrdarium };
type AnyAction = Action<any, any>;
/**
 * @deprecated Legacy DSH adapter leaf (frozen 2026-09-11, see COMPAT-DSH-002 in
 * evidence/compatibility-register.md). It receives no new capability and is not the
 * recommended integration path: use `@ordarium/core` with `@ordarium/host-kit`
 * (custom host) or `@ordarium/host-mcp` (MCP) instead.
 */
export interface InstallOrdariumOptions extends CreateDshOrdariumOptions {
    actions: readonly AnyAction[];
}
/**
 * @deprecated Legacy DSH adapter leaf (frozen 2026-09-11, see COMPAT-DSH-002 in
 * evidence/compatibility-register.md). It receives no new capability and is not the
 * recommended integration path: use `@ordarium/core` with `@ordarium/host-kit`
 * (custom host) or `@ordarium/host-mcp` (MCP) instead.
 */
export declare function installOrdarium(context: DshPluginContext, options: InstallOrdariumOptions): DshOrdarium & {
    dispose(): Promise<void>;
};
//# sourceMappingURL=install.d.ts.map