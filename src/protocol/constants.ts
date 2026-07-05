/**
 * The envelope schema this release writes and understands. Stored value
 * envelopes carry this alongside the application state version so future
 * protocol changes never silently mangle old data.
 */
export const PROTOCOL_VERSION = 1;

/** IndexedDB database name. One database per origin, one store per namespace. */
export const DB_NAME = "durable-local";

/** Object store name inside DB_NAME. Keyed by slot id. */
export const STORE_NAME = "slots";

/**
 * The default state version an application declares when it does not set
 * `version` on open(). Applications should treat 1 as their first schema
 * and migrate forward from there.
 */
export const DEFAULT_STATE_VERSION = 1;

/**
 * Slot names must be short, printable, and free of characters that would
 * collide with debugging tools or make the database inspector unreadable.
 * Grammar: 1..128 chars, [a-z0-9._-], must start with a letter or digit.
 */
export const SLOT_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;

/** Cross-tab notification channel name; scoped per origin. */
export const BROADCAST_CHANNEL_NAME = "durable-local/v1";
