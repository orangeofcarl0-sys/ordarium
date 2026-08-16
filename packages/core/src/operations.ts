import type { Action } from "./action.js";
import { OperatorAuthorizationRequiredError, OperationConflictError } from "./errors.js";
import { digestJson, type JsonValue } from "./json.js";
import type { OrdariumRuntime } from "./runtime.js";
import { operationIdentityPreview } from "./runtime.js";
import type {
  AuthorizationRecord,
  InvocationIdentity,
  OperationEvent,
  OperationLedger,
  OperationListFilter,
  OperationRecord,
  OperationState,
  ProviderPrincipalRef,
  SafeError,
  UncertaintyRecord,
} from "./types.js";

/**
 * Independent operator permission boundary (G4 spec §4). It never reuses
 * Action authorization evidence and cannot be self-granted through tool
 * input - only a trusted host adapter constructs it.
 */
export interface OperatorAuthorization {
  readonly operator: string;
  readonly source: string;
  readonly grantedAt: string;
  readonly scope?: "operations" | "operations:reconcile" | undefined;
}

/** Audited operator view (G4 spec §2): full lineage and classified evidence. */
export interface OperationView {
  readonly operationId: string;
  readonly actionName: string;
  readonly actionVersion: string;
  readonly effectKind: OperationRecord["effectKind"];
  readonly idempotencyMode: OperationRecord["idempotencyMode"];
  readonly idempotencyExpiresAt?: string | undefined;
  readonly state: OperationState;
  readonly attempts: number;
  readonly semanticRevision: number;
  readonly lastFencingToken: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly identity: InvocationIdentity;
  readonly authorization?: AuthorizationRecord | undefined;
  readonly error?: SafeError | undefined;
  readonly uncertainty?: UncertaintyRecord | undefined;
  readonly receipt?: JsonValue | undefined;
  readonly resultRef?: { readonly digest: string } | undefined;
}

/** Sanitized model view: no reason, actor, lineage, result or receipt bodies. */
export interface ModelOperationView {
  readonly operationId: string;
  readonly actionName: string;
  readonly actionVersion: string;
  readonly effectKind: OperationRecord["effectKind"];
  readonly state: OperationState;
  readonly attempts: number;
  readonly updatedAt: string;
  readonly reasonCode?: string | undefined;
}

export interface OperationViewPage {
  readonly views: readonly OperationView[];
  readonly nextCursor?: string | undefined;
}

export interface OperationEventView {
  readonly semanticRevision: number;
  readonly state: OperationState;
  readonly at: string;
  readonly view: OperationView;
}

export interface OperationEventViewPage {
  readonly events: readonly OperationEventView[];
  readonly nextCursor?: string | undefined;
}

export interface ReconcileOnlyRequest<I extends JsonValue, O extends JsonValue> {
  readonly operationId: string;
  readonly action: Action<I, O>;
  readonly input: unknown;
  readonly identity: InvocationIdentity;
  readonly authorization: OperatorAuthorization;
  readonly providerPrincipalRef?: ProviderPrincipalRef | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface OrdariumOperations {
  inspect(operationId: string, authorization: OperatorAuthorization): Promise<OperationView | undefined>;
  list(
    filter: OperationListFilter | undefined,
    cursor: string | undefined,
    authorization: OperatorAuthorization,
  ): Promise<OperationViewPage>;
  history(
    operationId: string,
    cursor: string | undefined,
    limit: number | undefined,
    authorization: OperatorAuthorization,
  ): Promise<OperationEventViewPage>;
  reconcileOnly<I extends JsonValue, O extends JsonValue>(
    request: ReconcileOnlyRequest<I, O>,
  ): Promise<O>;
}

export interface CreateOperationsOptions {
  /** Required for reconcileOnly; read paths work from a bare ledger. */
  readonly runtime?: OrdariumRuntime | undefined;
  readonly ledger?: OperationLedger | undefined;
}

/**
 * The Operations service stays in @ordarium/core (G4 spec §1): a thin,
 * audited read surface over the ledger plus a query-only disposal path that
 * wraps runtime.reconcileOnly. It has no execute, no force retry, no raw
 * SQL filter and no second recovery engine.
 */
export function createOperations(options: CreateOperationsOptions = {}): OrdariumOperations {
  const ledger = options.ledger ?? options.runtime?.ledger;
  if (ledger === undefined) {
    throw new TypeError("createOperations requires a runtime or a ledger");
  }
  const runtime = options.runtime;

  return {
    async inspect(operationId, authorization) {
      assertOperatorAuthorization(authorization, "operations");
      const record = await ledger.get(operationId);
      return record === undefined ? undefined : projectOperatorView(record);
    },

    async list(filter, cursor, authorization) {
      assertOperatorAuthorization(authorization, "operations");
      const page = await ledger.list(filter ?? {}, cursor);
      return {
        views: page.records.map(projectOperatorView),
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      };
    },

    async history(operationId, cursor, limit, authorization) {
      assertOperatorAuthorization(authorization, "operations");
      const page = await ledger.history(operationId, cursor, limit);
      return {
        events: page.events.map(projectEventView),
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      };
    },

    async reconcileOnly(request) {
      assertOperatorAuthorization(request.authorization, "operations:reconcile");
      if (runtime === undefined) {
        throw new TypeError("reconcileOnly requires a runtime-backed Operations service");
      }
      // Recovery material verification (G4 spec §3): the presented action,
      // input and identity must reproduce the durable operation exactly.
      // Any mismatch fails closed before the runtime - and the Provider -
      // are touched.
      const preview = operationIdentityPreview(request.action, request.input, request.identity);
      if (preview.operationId !== request.operationId) {
        throw new OperationConflictError(request.operationId);
      }
      const record = await ledger.get(request.operationId);
      if (
        record === undefined ||
        record.actionName !== request.action.name ||
        record.actionVersion !== request.action.version ||
        record.inputDigest !== preview.inputDigest ||
        record.logicalKeyDigest !== preview.logicalKeyDigest
      ) {
        throw new OperationConflictError(request.operationId);
      }
      return runtime.reconcileOnly(request.action, request.input, {
        identity: request.identity,
        ...(request.providerPrincipalRef === undefined
          ? {}
          : { providerPrincipalRef: request.providerPrincipalRef }),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });
    },
  };
}

export function assertOperatorAuthorization(
  authorization: OperatorAuthorization,
  required: "operations" | "operations:reconcile",
): void {
  const invalid = () => new OperatorAuthorizationRequiredError();
  if (authorization === null || typeof authorization !== "object") throw invalid();
  for (const field of ["operator", "source"] as const) {
    const value = authorization[field];
    if (typeof value !== "string" || value.length === 0 || value.length > 256) throw invalid();
  }
  if (typeof authorization.grantedAt !== "string" || !Number.isFinite(Date.parse(authorization.grantedAt))) {
    throw invalid();
  }
  const scope = authorization.scope ?? "operations";
  if (scope !== "operations" && scope !== "operations:reconcile") throw invalid();
  if (required === "operations:reconcile" && scope !== "operations:reconcile") throw invalid();
}

function projectOperatorView(record: OperationRecord): OperationView {
  return {
    operationId: record.operationId,
    actionName: record.actionName,
    actionVersion: record.actionVersion,
    effectKind: record.effectKind,
    idempotencyMode: record.idempotencyMode,
    ...(record.idempotencyExpiresAt === undefined
      ? {}
      : { idempotencyExpiresAt: record.idempotencyExpiresAt }),
    state: record.state,
    attempts: record.attempts,
    semanticRevision: record.semanticRevision,
    lastFencingToken: record.lastFencingToken,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    identity: record.identity,
    ...(record.authorization === undefined ? {} : { authorization: record.authorization }),
    ...(record.error === undefined ? {} : { error: record.error }),
    ...(record.uncertainty === undefined ? {} : { uncertainty: record.uncertainty }),
    ...(record.receipt === undefined ? {} : { receipt: record.receipt }),
    ...(record.result === undefined ? {} : { resultRef: { digest: digestJson(record.result) } }),
  };
}

/** The model view is the same projector with a stricter field policy. */
export function projectModelView(record: OperationRecord): ModelOperationView {
  return {
    operationId: record.operationId,
    actionName: record.actionName,
    actionVersion: record.actionVersion,
    effectKind: record.effectKind,
    state: record.state,
    attempts: record.attempts,
    updatedAt: record.updatedAt,
    ...(record.uncertainty === undefined ? {} : { reasonCode: record.uncertainty.reason }),
  };
}

function projectEventView(event: OperationEvent): OperationEventView {
  return {
    semanticRevision: event.semanticRevision,
    state: event.state,
    at: event.at,
    view: projectOperatorView(event.record),
  };
}
