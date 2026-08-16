import type { Action } from "@ordarium/core";
import { type CreateDshOrdariumOptions, type DshOrdarium, type DshPluginContext } from "./advanced.js";
export type { CreateDshOrdariumOptions, DshOrdarium };
type AnyAction = Action<any, any>;
export interface InstallOrdariumOptions extends CreateDshOrdariumOptions {
    actions: readonly AnyAction[];
}
export declare function installOrdarium(context: DshPluginContext, options: InstallOrdariumOptions): DshOrdarium & {
    dispose(): Promise<void>;
};
//# sourceMappingURL=install.d.ts.map