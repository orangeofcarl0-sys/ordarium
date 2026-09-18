// Curated author façade (COMPAT-API-002 cutover, G1-002). The root entry
// exposes exactly the golden path: define actions and install them. Low-level
// binding, lifecycle tuning and custom ledger access live in
// "@ordarium/dsh/advanced"; Runtime/Ledger/raw record types are never
// re-exported from here.

/**
 * @deprecated Legacy DSH adapter leaf (frozen 2026-09-11, see COMPAT-DSH-002 in
 * evidence/compatibility-register.md). It receives no new capability and is not the
 * recommended integration path: use `@ordarium/core` with `@ordarium/host-kit`
 * (custom host) or `@ordarium/host-mcp` (MCP) instead.
 */
export {
  defineAction,
  defineSchema,
  effects,
  jsonValueSchema,
  schema,
} from "@ordarium/core";
/**
 * @deprecated Legacy DSH adapter leaf (frozen 2026-09-11, see COMPAT-DSH-002 in
 * evidence/compatibility-register.md). It receives no new capability and is not the
 * recommended integration path: use `@ordarium/core` with `@ordarium/host-kit`
 * (custom host) or `@ordarium/host-mcp` (MCP) instead.
 */
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
/**
 * @deprecated Legacy DSH adapter leaf (frozen 2026-09-11, see COMPAT-DSH-002 in
 * evidence/compatibility-register.md). It receives no new capability and is not the
 * recommended integration path: use `@ordarium/core` with `@ordarium/host-kit`
 * (custom host) or `@ordarium/host-mcp` (MCP) instead.
 */
export { installOrdarium } from "./install.js";
/**
 * @deprecated Legacy DSH adapter leaf (frozen 2026-09-11, see COMPAT-DSH-002 in
 * evidence/compatibility-register.md). It receives no new capability and is not the
 * recommended integration path: use `@ordarium/core` with `@ordarium/host-kit`
 * (custom host) or `@ordarium/host-mcp` (MCP) instead.
 */
export type {
  CreateDshOrdariumOptions,
  DshOrdarium,
  InstallOrdariumOptions,
} from "./install.js";
