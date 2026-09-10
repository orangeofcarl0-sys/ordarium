import { type ClaimRequest, type LiveLease, type OperationEventPage, type OperationLedger, type OperationListFilter, type OperationPage, type OperationRecord, type StateChangeFeed, type StateChangeFilter, type StateChangePage, type StateListFilter, type StateRecord, type StateRecordPage, type StateRef, type StateRevisionPage } from "@ordarium/core";
export interface SqliteLedgerOpenRetry {
    /** Total attempts including the first; 1 restores fail-fast. Default 5. */
    attempts?: number | undefined;
    /** Fixed delay between attempts in milliseconds. Default 100. */
    delayMs?: number | undefined;
}
export interface SqliteLedgerOptions {
    timeoutMs?: number | undefined;
    clock?: (() => Date) | undefined;
    /**
     * Open-boundary retry (G16): only LEDGER_BUSY failures (including a busy
     * migration segment) are retried with a fixed delay; corruption, newer
     * schema and migration-failure errors fail closed exactly once. Defaults
     * to { attempts: 5, delayMs: 100 }.
     */
    openRetry?: SqliteLedgerOpenRetry | undefined;
}
/**
 * Crash-durable SQLite reference ledger implementing the full v2 port
 * contract (G2 design spec §2/§3) plus the G11 state kind: semantic CAS with
 * fence verification, atomic claim+lease, lightweight lease renewal that
 * never touches semantic state, revision-CAS management state with a
 * reference reverse index, opaque cursor pagination, transactional forward
 * migrations (v1 -> v3 rebuild, v2 -> v3 additive) and a stable
 * infrastructure error family.
 */
export declare class SqliteLedger implements OperationLedger, StateChangeFeed {
    #private;
    readonly capabilities: {
        readonly durability: "crash-durable";
        readonly coordination: "local-multi-process";
        readonly semanticCas: true;
        readonly liveLease: true;
        readonly semanticHistory: true;
        readonly stateRevisions: true;
        readonly stateChangeFeed: true;
    };
    readonly path: string;
    constructor(path: string, options?: SqliteLedgerOptions);
    get(operationId: string): Promise<OperationRecord | undefined>;
    create(record: OperationRecord): Promise<{
        created: boolean;
        record: OperationRecord;
    }>;
    compareAndSet(operationId: string, expectedRevision: number, next: OperationRecord): Promise<boolean>;
    claim(operationId: string, expectedRevision: number, request: ClaimRequest, lease: {
        owner: string;
        fencingToken: number;
        expiresAt: string;
    }): Promise<boolean>;
    lease(operationId: string): Promise<LiveLease | undefined>;
    renewLease(operationId: string, owner: string, fencingToken: number, expiresAt: string): Promise<boolean>;
    history(operationId: string, cursor?: string, limit?: number): Promise<OperationEventPage>;
    list(filter?: OperationListFilter, cursor?: string): Promise<OperationPage>;
    getState(namespace: string, key: string): Promise<StateRecord | undefined>;
    compareAndSetState(namespace: string, key: string, expectedRevision: number, next: StateRecord): Promise<boolean>;
    changes(filter?: StateChangeFilter, cursor?: string): Promise<StateChangePage>;
    stateHistory(namespace: string, key: string, cursor?: string, limit?: number): Promise<StateRevisionPage>;
    listStatesReferencing(ref: StateRef, cursor?: string, limit?: number): Promise<StateRecordPage>;
    listStates(filter?: StateListFilter, cursor?: string): Promise<StateRecordPage>;
    close(): void;
}
//# sourceMappingURL=index.d.ts.map