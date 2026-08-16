import type { OperationEvent, OperationLedger, OperationListFilter, OperationRecord } from "./types.js";
export declare class MemoryLedger implements OperationLedger {
    #private;
    readonly capabilities: {
        readonly durability: "volatile";
        readonly coordination: "single-isolate";
        readonly semanticCas: true;
        readonly liveLease: true;
        readonly semanticHistory: true;
    };
    get(operationId: string): Promise<OperationRecord | undefined>;
    create(record: OperationRecord): Promise<{
        created: boolean;
        record: OperationRecord;
    }>;
    compareAndSet(operationId: string, expectedRevision: number, next: OperationRecord): Promise<boolean>;
    history(operationId: string): Promise<OperationEvent[]>;
    list(filter?: OperationListFilter): Promise<OperationRecord[]>;
}
//# sourceMappingURL=ledger.d.ts.map