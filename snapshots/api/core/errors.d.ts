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
export declare class IdentityRequiredError extends OrdariumError {
    constructor();
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
export declare class SimulatedProcessCrash extends OrdariumError {
    constructor(operationId?: string);
}
//# sourceMappingURL=errors.d.ts.map