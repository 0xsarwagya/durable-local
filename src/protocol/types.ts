/**
 * What durable-local moves in and out of storage: JSON-compatible values,
 * nothing else. No Date, no Blob, no ArrayBuffer, no Map, no Set — IDB can
 * structured-clone all of those, but the v1 promise is deliberately
 * smaller than what the underlying storage supports. See docs/concepts/
 * slots for the reasoning.
 */
export type DurableValue =
  | null
  | boolean
  | number
  | string
  | DurableValue[]
  | { [key: string]: DurableValue };

/**
 * The envelope written to IndexedDB. Application code never sees this;
 * it exists so future protocol changes cannot silently reinterpret
 * stored bytes as a different application schema.
 */
export interface StoredEnvelope<T extends DurableValue = DurableValue> {
  /** Envelope schema version (owned by durable-local). */
  protocolVersion: number;
  /** Application-declared state version. */
  stateVersion: number;
  /** Monotonic per-slot revision. Increments on every successful commit. */
  revision: number;
  /** ISO timestamp of the commit that produced this envelope. */
  updatedAt: string;
  /** The application value. */
  value: T;
}

/** Reason a cross-tab observer received a new committed revision. */
export type CommitSource = "local" | "external" | "migration" | "reset";

/** Broadcast payload sent when a slot commits. Never carries the value. */
export interface CommitNotice {
  slot: string;
  revision: number;
  source: CommitSource;
}
