// Curated author façade (COMPAT-API-002 cutover, G1-002). The root entry
// exposes exactly the golden path: define actions and install them. Low-level
// binding, lifecycle tuning and custom ledger access live in
// "@ordarium/dsh/advanced"; Runtime/Ledger/raw record types are never
// re-exported from here.

export {
  defineAction,
  defineSchema,
  effects,
  jsonValueSchema,
  schema,
} from "@ordarium/core";
export type {
  Action,
  ActionDefinition,
  ActionExecutionContext,
  ActionSchema,
  AuthorizationDecision,
  EffectProfile,
  InvocationIdentity,
  JsonObject,
  JsonValue,
  ReconcileResult,
} from "@ordarium/core";
export { installOrdarium } from "./install.js";
export type {
  CreateDshOrdariumOptions,
  DshOrdarium,
  InstallOrdariumOptions,
} from "./install.js";
