import type { OperationEvent, OperationLedger, OperationListFilter, OperationRecord } from "@ordarium/core";
export interface SqliteLedgerOptions {
    timeoutMs?: number | undefined;
}
export declare class SqliteLedger implements OperationLedger {
    #private;
    readonly path: string;
    constructor(path: string, options?: SqliteLedgerOptions);
    get(operationId: string): Promise<OperationRecord | undefined>;
    create(record: OperationRecord): Promise<{
        created: boolean;
        record: OperationRecord;
    }>;
    compareAndSet(operationId: string, expectedRevision: number, next: OperationRecord): Promise<boolean>;
    history(operationId: string): Promise<OperationEvent[]>;
    list(filter?: OperationListFilter): Promise<OperationRecord[]>;
    close(): void;
}
//# sourceMappingURL=index.d.ts.map