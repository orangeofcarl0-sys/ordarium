import type { Action, JsonValue } from "@ordarium/core";

import {
  createDshOrdarium,
  type CreateDshOrdariumOptions,
  type DshOrdarium,
  type DshPluginContext,
} from "./advanced.js";

export type { CreateDshOrdariumOptions, DshOrdarium };

type AnyAction = Action<any, any>;

export interface InstallOrdariumOptions extends CreateDshOrdariumOptions {
  actions: readonly AnyAction[];
}

export function installOrdarium(
  context: DshPluginContext,
  options: InstallOrdariumOptions,
): DshOrdarium & { dispose(): Promise<void> } {
  const ordarium = createDshOrdarium(options);
  const unregister = ordarium.register(context, options.actions);
  return {
    ...ordarium,
    async dispose() {
      // Frozen disposal order (docs/17 §11.3): quiesce before unregister so
      // racing calls fail closed while the tools are still host-visible,
      // then bounded drain -> abort -> handoff -> close inside the runtime.
      await ordarium.runtime.quiesce();
      unregister();
      await ordarium.close();
    },
  };
}
