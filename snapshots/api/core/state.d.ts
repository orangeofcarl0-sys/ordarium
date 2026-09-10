import { type JsonValue } from "./json.js";
import type { OrdariumRuntime } from "./runtime.js";
import type { AuthorizationDecision, InvocationIdentity, OperationLedger, StateChangeFeed, StateChangeFilter, StateChangePage, StateListFilter, StateRecord, StateRecordPage, StateRef, StateRevisionPage } from "./types.js";
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
    history(namespace: string, key: string, cursor: string | undefined, limit: number | undefined): Promise<StateRevisionPage>;
    listReferencing(ref: StateRef, cursor: string | undefined, limit: number | undefined): Promise<StateRecordPage>;
    list(filter: StateListFilter | undefined, cursor: string | undefined): Promise<StateRecordPage>;
    /**
     * Incremental observation of committed state revisions after a durable
     * position (ORD-BOOT-0). Delegates to the ledger's StateChangeFeed; a ledger
     * without the capability fails closed with LEDGER_CAPABILITY_REQUIRED.
     */
    changes(filter?: StateChangeFilter, cursor?: string): Promise<StateChangePage>;
}
/**
 * Fail-closed entry to the state change feed (ORD-BOOT-0): the ledger must
 * both declare `stateChangeFeed` and expose `changes`. Capability declaration
 * is explicit by design - the guard never infers support from a class name.
 */
export declare function supportsStateChangeFeed(ledger: OperationLedger): ledger is OperationLedger & StateChangeFeed;
export interface CreateStateStoreOptions {
    /** Binding to a runtime adds the quiesce/close gates to every write. */
    readonly runtime?: OrdariumRuntime | undefined;
    /** Required for any path; read paths work from a bare ledger. */
    readonly ledger?: OperationLedger | undefined;
    readonly clock?: (() => Date) | undefined;
    readonly maxValueJsonBytes?: number | undefined;
}
export declare function createStateStore(options?: CreateStateStoreOptions): OrdariumStateStore;
//# sourceMappingURL=state.d.ts.map