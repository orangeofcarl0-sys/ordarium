export class OrdariumError extends Error {
  readonly code: string;
  readonly operationId?: string | undefined;

  constructor(code: string, message: string, operationId?: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.operationId = operationId;
  }
}

export class AuthorizationRequiredError extends OrdariumError {
  constructor(operationId: string) {
    super("AUTHORIZATION_REQUIRED", "The action requires an authorization decision", operationId);
  }
}

export class AuthorizationConflictError extends OrdariumError {
  constructor(operationId: string) {
    super(
      "AUTHORIZATION_CONFLICT",
      "The operation already holds a durable authorization decision; contradictory evidence was rejected",
      operationId,
    );
  }
}

export class IdentityRequiredError extends OrdariumError {
  constructor() {
    super(
      "IDENTITY_REQUIRED",
      "A managed side effect requires a stable host-provided invocation identity",
    );
  }
}

export class ActionDeniedError extends OrdariumError {
  constructor(operationId: string) {
    super("ACTION_DENIED", "The action was denied", operationId);
  }
}

export class OperationConflictError extends OrdariumError {
  constructor(operationId: string) {
    super(
      "OPERATION_CONFLICT",
      "The operation identity was reused with different action input",
      operationId,
    );
  }
}

export class OperationBusyError extends OrdariumError {
  constructor(operationId: string) {
    super("OPERATION_BUSY", "The operation is claimed by another executor", operationId);
  }
}

export class OperationFailedError extends OrdariumError {
  constructor(operationId: string, message = "The action failed") {
    super("OPERATION_FAILED", message, operationId);
  }
}

export class OperationCancelledError extends OrdariumError {
  constructor(operationId: string) {
    super("OPERATION_CANCELLED", "The action was cancelled", operationId);
  }
}

export class UncertainOperationError extends OrdariumError {
  constructor(operationId: string) {
    super(
      "OPERATION_UNCERTAIN",
      "The external outcome is uncertain; Ordarium refused a blind retry",
      operationId,
    );
  }
}

export class PersistedValueTooLargeError extends OrdariumError {
  constructor(operationId: string, label: string, limit: number) {
    super(
      "PERSISTED_VALUE_TOO_LARGE",
      `${label} exceeds the configured ${limit}-byte persistence limit`,
      operationId,
    );
  }
}

export class SimulatedProcessCrash extends OrdariumError {
  constructor(operationId?: string) {
    super("SIMULATED_PROCESS_CRASH", "Simulated process crash", operationId);
  }
}
