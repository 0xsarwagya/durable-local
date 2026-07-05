export type DurableErrorCode =
  | "UNSUPPORTED"
  | "STORAGE_UNAVAILABLE"
  | "OPEN_FAILED"
  | "STATE_INVALID"
  | "MIGRATION_REQUIRED"
  | "MIGRATION_FAILED"
  | "FUTURE_VERSION"
  | "COMMIT_FAILED"
  | "QUOTA_EXCEEDED"
  | "UNSUPPORTED_VALUE"
  | "SLOT_DESTROYED"
  | "SLOT_NAME_INVALID"
  | "CONFLICT";

export type DurableOperation =
  | "open"
  | "set"
  | "update"
  | "reset"
  | "destroy"
  | "subscribe"
  | "storage"
  | "requestPersistence"
  | "migrate"
  | "validate";

export class DurableError extends Error {
  readonly code: DurableErrorCode;
  readonly operation: DurableOperation;
  readonly slot: string | undefined;

  constructor(options: {
    code: DurableErrorCode;
    message: string;
    operation: DurableOperation;
    slot?: string;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "DurableError";
    this.code = options.code;
    this.operation = options.operation;
    this.slot = options.slot;
  }
}

export function isDurableError(value: unknown): value is DurableError {
  return value instanceof DurableError;
}
