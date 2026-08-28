import { decodeStateRecord, parseStateRefId, RESOURCE_LIMITS } from "./codec.js";
import {
  LedgerCapabilityRequiredError,
  PersistedValueTooLargeError,
  RuntimeClosedError,
  RuntimeQuiescingError,
  StateRefNotFoundError,
  StateRevisionConflictError,
} from "./errors.js";
import { canonicalJson, digestJson, type JsonValue } from "./json.js";
import type { OrdariumRuntime } from "./runtime.js";
import type {
  AuthorizationDecision,
  InvocationIdentity,
  OperationLedger,
  StateListFilter,
  StateRecord,
  StateRecordPage,
  StateRef,
  StateRevisionPage,
} from "./types.js";

/**
 * The management state surface (G11 design spec §2): the host-declared,
 * revision-CAS'd half of the shared timeline. It owns no recovery engine and
 * no second validator - shape truth lives in the codec, concurrency truth in
 * the ledger CAS, and reference semantics stay with the host.
 */
export interface StateWriteRequest {
  namespace: string;
  key: string;
  /** The revision this write is based on; 0 creates the subject. */
  expectedRevision: number;
  value: JsonValue;
  refs?: readonly StateRef[] | undefined;
  identity: InvocationIdentity;
  authorization?: AuthorizationDecision | undefined;
}

export interface OrdariumStateStore {
  get(namespace: string, key: string): Promise<StateRecord | undefined>;
  /** Optimistic CAS write; a moved revision fails closed with STATE_REVISION_CONFLICT. */
  write(request: StateWriteRequest): Promise<StateRecord>;
  history(
    namespace: string,
    key: string,
    cursor: string | undefined,
    limit: number | undefined,
  ): Promise<StateRevisionPage>;
  listReferencing(
    ref: StateRef,
    cursor: string | undefined,
    limit: number | undefined,
  ): Promise<StateRecordPage>;
  list(filter: StateListFilter | undefined, cursor: string | undefined): Promise<StateRecordPage>;
}

export interface CreateStateStoreOptions {
  /** Binding to a runtime adds the quiesce/close gates to every write. */
  readonly runtime?: OrdariumRuntime | undefined;
  /** Required for any path; read paths work from a bare ledger. */
  readonly ledger?: OperationLedger | undefined;
  readonly clock?: (() => Date) | undefined;
  readonly maxValueJsonBytes?: number | undefined;
}

export function createStateStore(options: CreateStateStoreOptions = {}): OrdariumStateStore {
  const ledger = options.ledger ?? options.runtime?.ledger;
  if (ledger === undefined) {
    throw new TypeError("createStateStore requires a runtime or a ledger");
  }
  const runtime = options.runtime;
  const clock = options.clock ?? (() => new Date());
  const maxValueJsonBytes = options.maxValueJsonBytes ?? RESOURCE_LIMITS.maxStateValueJsonBytes;

  return {
    async get(namespace, key) {
      return ledger.getState(namespace, key);
    },

    async write(request) {
      if (runtime !== undefined) {
        if (runtime.lifecycle === "closing" || runtime.lifecycle === "closed") {
          throw new RuntimeClosedError();
        }
        if (runtime.lifecycle !== "accepting") {
          throw new RuntimeQuiescingError();
        }
      }
      if (ledger.capabilities.stateRevisions !== true) {
        throw new LedgerCapabilityRequiredError("revisioned shared state on the state kind");
      }
      const now = clock().toISOString();
      const draft: StateRecord = {
        schemaVersion: 1,
        namespace: request.namespace,
        key: request.key,
        revision: request.expectedRevision + 1,
        value: request.value,
        valueDigest: digestJson(request.value),
        refs: [...(request.refs ?? [])],
        identity: request.identity,
        ...(request.authorization === undefined
          ? {}
          : { authorization: { ...request.authorization, at: now } }),
        writtenAt: now,
      };
      // Single validation path: identity, authorization, subject naming,
      // value shape and the digest invariant are all codec truth.
      decodeStateRecord(draft);
      if (Buffer.byteLength(canonicalJson(request.value), "utf8") > maxValueJsonBytes) {
        throw new PersistedValueTooLargeError(
          undefined,
          `State value of ${request.namespace}/${request.key}`,
          maxValueJsonBytes,
        );
      }
      await assertRefsExist(ledger, draft.refs);

      const applied = await ledger.compareAndSetState(
        request.namespace,
        request.key,
        request.expectedRevision,
        draft,
      );
      if (!applied) {
        const current = await ledger.getState(request.namespace, request.key);
        throw new StateRevisionConflictError(
          current === undefined
            ? `${request.namespace}/${request.key} does not exist (expected revision ${request.expectedRevision})`
            : `${request.namespace}/${request.key} is at revision ${current.revision}; expected ${request.expectedRevision}`,
        );
      }
      return draft;
    },

    async history(namespace, key, cursor, limit) {
      return ledger.stateHistory(namespace, key, cursor, limit);
    },

    async listReferencing(ref, cursor, limit) {
      return ledger.listStatesReferencing(ref, cursor, limit);
    },

    async list(filter, cursor) {
      return ledger.listStates(filter, cursor);
    },
  };
}

/**
 * Reference existence is a structural guarantee (G11 §3): a write that
 * points at an absent operation or state revision fails closed before the
 * CAS, so the timeline never holds a dangling pointer.
 */
async function assertRefsExist(ledger: OperationLedger, refs: readonly StateRef[]): Promise<void> {
  for (const ref of refs) {
    if (ref.kind === "operation") {
      if (await ledger.get(ref.id) === undefined) {
        throw new StateRefNotFoundError(`operation ${ref.id}`);
      }
      continue;
    }
    const parsed = parseStateRefId(ref.id);
    if (parsed === undefined) {
      throw new StateRefNotFoundError(`unparseable state revision ${ref.id}`);
    }
    const target = await ledger.getState(parsed.namespace, parsed.key);
    if (target === undefined || target.revision !== parsed.revision) {
      throw new StateRefNotFoundError(`state revision ${ref.id}`);
    }
  }
}
