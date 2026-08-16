import { type ClaimRequest, type LiveLease, type OperationEventPage, type OperationLedger, type OperationListFilter, type OperationPage, type OperationRecord } from "@ordarium/core";
export interface SqliteLedgerOptions {
    timeoutMs?: number | undefined;
    clock?: (() => Date) | undefined;
}
/**
 * Crash-durable SQLite reference ledger implementing the full v2 port
 * contract (G2 design spec §2/§3): semantic CAS with fence verification,
 * atomic claim+lease, lightweight lease renewal that never touches semantic
 * state, opaque cursor pagination, a transactional v1->v2 forward migration
 * and a stable infrastructure error family.
 */
export declare class SqliteLedger implements OperationLedger {
    #private;
    readonly capabilities: {
        readonly durability: "crash-durable";
        readonly coordination: "local-multi-process";
        readonly semanticCas: true;
        readonly liveLease: true;
        readonly semanticHistory: true;
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
    close(): void;
}
//# sourceMappingURL=index.d.ts.map