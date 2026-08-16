import type { ClaimRequest, LiveLease, OperationEventPage, OperationLedger, OperationListFilter, OperationPage, OperationRecord } from "./types.js";
/**
 * Volatile single-isolate ledger implementing the full v2 port contract
 * (G2 design spec §2): semantic CAS, atomic claim+lease, lightweight lease
 * renewal that never touches semantic state, and opaque cursor pagination.
 */
export declare class MemoryLedger implements OperationLedger {
    #private;
    readonly capabilities: {
        readonly durability: "volatile";
        readonly coordination: "single-isolate";
        readonly semanticCas: true;
        readonly liveLease: true;
        readonly semanticHistory: true;
    };
    constructor(options?: {
        clock?: (() => Date) | undefined;
    });
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
}
//# sourceMappingURL=ledger.d.ts.map