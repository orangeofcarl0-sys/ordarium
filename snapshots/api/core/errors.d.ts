export declare class OrdariumError extends Error {
    readonly code: string;
    readonly operationId?: string | undefined;
    constructor(code: string, message: string, operationId?: string);
}
export declare class AuthorizationRequiredError extends OrdariumError {
    constructor(operationId: string);
}
export declare class AuthorizationConflictError extends OrdariumError {
    constructor(operationId: string);
}
export declare class PrincipalConflictError extends OrdariumError {
    constructor(operationId: string);
}
export declare class OperatorAuthorizationRequiredError extends OrdariumError {
    constructor();
}
export declare class ContractDriftError extends OrdariumError {
    constructor(operationId: string);
}
export declare class IdentityRequiredError extends OrdariumError {
    constructor();
}
export declare class LedgerCapabilityRequiredError extends OrdariumError {
    constructor(requirement: string);
}
export declare class RuntimeQuiescingError extends OrdariumError {
    constructor();
}
export declare class RuntimeClosedError extends OrdariumError {
    constructor();
}
export declare class IdempotencyExpiredError extends OrdariumError {
    constructor(operationId: string);
}
export declare class ActionDeniedError extends OrdariumError {
    constructor(operationId: string);
}
export declare class OperationConflictError extends OrdariumError {
    constructor(operationId: string);
}
export declare class OperationBusyError extends OrdariumError {
    constructor(operationId: string);
}
export declare class OperationFailedError extends OrdariumError {
    constructor(operationId: string, message?: string);
}
export declare class OperationCancelledError extends OrdariumError {
    constructor(operationId: string);
}
export declare class UncertainOperationError extends OrdariumError {
    constructor(operationId: string);
}
export declare class PersistedValueTooLargeError extends OrdariumError {
    constructor(operationId: string, label: string, limit: number);
}
export declare class InputTooLargeError extends OrdariumError {
    constructor(limit: number);
}
export declare class SimulatedProcessCrash extends OrdariumError {
    constructor(operationId?: string);
}
/**
 * Stable infrastructure error family (G2 design spec §5). Callers decide on
 * these codes; parsing raw SQLite messages is forbidden (G2-A07).
 */
export declare class LedgerOpenFailedError extends OrdariumError {
    constructor(detail: string);
}
export declare class LedgerNewerSchemaError extends OrdariumError {
    constructor(version: number);
}
export declare class LedgerMigrationFailedError extends OrdariumError {
    constructor(detail: string);
}
export declare class LedgerBusyError extends OrdariumError {
    constructor();
}
export declare class LedgerCorruptError extends OrdariumError {
    constructor();
}
export declare class LedgerClosedError extends OrdariumError {
    constructor();
}
export declare class LedgerFullError extends OrdariumError {
    constructor();
}
//# sourceMappingURL=errors.d.ts.map