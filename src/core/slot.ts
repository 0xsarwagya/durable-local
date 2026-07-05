import { DurableError, type DurableOperation } from "../errors.js";
import {
  publish,
  subscribe as subscribeToBroadcast,
  subscribeToPageshowPoke,
} from "../coordination/broadcast.js";
import {
  DEFAULT_STATE_VERSION,
  PROTOCOL_VERSION,
  SLOT_NAME_PATTERN,
} from "../protocol/constants.js";
import { assertDurableValue } from "../protocol/state.js";
import type {
  CommitNotice,
  CommitSource,
  DurableValue,
  StoredEnvelope,
} from "../protocol/types.js";
import { readEnvelope, withReadWrite } from "../storage/idb.js";

export type Migration<Prev extends DurableValue, Next extends DurableValue> = (
  value: Prev,
) => Next;

export type MigrationMap = Record<number, Migration<DurableValue, DurableValue>>;

export interface OpenSlotOptions<T extends DurableValue> {
  /** The value used only on first open, when no committed state exists. */
  initial: T;
  /**
   * The application's current state version. Defaults to 1. Bumping this
   * requires supplying migrations that walk each intermediate step to the
   * new version.
   */
  version?: number;
  /**
   * Sequential migrations. Key N is the migration that runs against a
   * value stored at state version N and returns a value at version N+1.
   */
  migrations?: MigrationMap;
  /**
   * Optional runtime validator. Runs after read, after migration, and
   * before every commit. May throw or return a corrected value.
   */
  validate?: (value: unknown) => T;
}

export type SubscribeEvent = {
  revision: number;
  source: CommitSource;
};

export interface Slot<T extends DurableValue> {
  readonly name: string;
  readonly stateVersion: number;
  /** The current committed value. */
  readonly value: T;
  /** The current committed revision. Increments on every successful commit. */
  readonly revision: number;
  /** Replace the value atomically. */
  set(next: T): Promise<void>;
  /**
   * Read the current committed value inside a single readwrite
   * transaction, run the synchronous updater, write the result. The
   * updater MUST NOT be async — awaiting a non-IDB promise inside a
   * transaction closes it early (WebKit is strictest).
   */
  update(updater: (current: T) => T): Promise<void>;
  /** Subscribe to committed changes; unsubscribe by calling the returned fn. */
  subscribe(listener: (value: T, event: SubscribeEvent) => void): () => void;
  /** Replace the value with the initial value, keeping the slot registered. */
  reset(): Promise<void>;
  /** Delete the slot; future open() with this name behaves as a first open. */
  destroy(): Promise<void>;
}

interface InternalSlot<T extends DurableValue> extends Slot<T> {
  __close(): void;
}

interface RegistryEntry {
  slot: InternalSlot<DurableValue>;
  handles: number;
  disposers: (() => void)[];
  destroyed: boolean;
}

/** namespace/name → registry entry. One backing slot per composite key. */
const registry = new Map<string, RegistryEntry>();

/** Test seam — drops the in-process handle cache to simulate a reload. */
export function __resetForTests(): void {
  for (const entry of registry.values()) {
    for (const dispose of entry.disposers) {
      try {
        dispose();
      } catch {
        /* ignore */
      }
    }
    entry.slot.__close();
  }
  registry.clear();
}

export function slotKey(namespace: string, name: string): string {
  return `${namespace}/${name}`;
}

function assertSlotName(name: string, operation: DurableOperation): void {
  if (!SLOT_NAME_PATTERN.test(name)) {
    throw new DurableError({
      code: "SLOT_NAME_INVALID",
      operation,
      slot: name,
      message: `Slot name "${name}" is invalid. Must match ${SLOT_NAME_PATTERN}.`,
    });
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

async function loadAndMigrate<T extends DurableValue>(
  key: string,
  options: OpenSlotOptions<T>,
): Promise<{ value: T; revision: number; source: CommitSource | null }> {
  const targetVersion = options.version ?? DEFAULT_STATE_VERSION;
  const validate = options.validate ?? ((value: unknown) => value as T);
  const migrations = options.migrations ?? {};

  const existing = await readEnvelope(key, "open");
  if (existing === null) {
    // First open. Seed with initial + commit.
    assertDurableValue(options.initial, "open", key);
    let validated: T;
    try {
      validated = validate(options.initial);
    } catch (cause) {
      throw new DurableError({
        code: "STATE_INVALID",
        operation: "open",
        slot: key,
        message: "Initial value failed validation.",
        cause,
      });
    }
    assertDurableValue(validated, "open", key);
    const seeded = await withReadWrite(key, "open", (current) => {
      if (current !== null) {
        return { next: current, result: current };
      }
      const next: StoredEnvelope<T> = {
        protocolVersion: PROTOCOL_VERSION,
        stateVersion: targetVersion,
        revision: 1,
        updatedAt: nowIso(),
        value: validated,
      };
      return { next, result: next };
    });
    return { value: seeded.value as T, revision: seeded.revision, source: null };
  }

  if (existing.stateVersion > targetVersion) {
    throw new DurableError({
      code: "FUTURE_VERSION",
      operation: "open",
      slot: key,
      message: `Stored state is at version ${existing.stateVersion}; this build only understands up to ${targetVersion}.`,
    });
  }

  if (existing.stateVersion < targetVersion) {
    let cursor: DurableValue = existing.value;
    for (let v = existing.stateVersion; v < targetVersion; v += 1) {
      const step = migrations[v];
      if (typeof step !== "function") {
        throw new DurableError({
          code: "MIGRATION_REQUIRED",
          operation: "open",
          slot: key,
          message: `Missing migration ${v} → ${v + 1}. Stored state is at version ${existing.stateVersion}; the build declares ${targetVersion}.`,
        });
      }
      try {
        cursor = step(cursor);
      } catch (cause) {
        throw new DurableError({
          code: "MIGRATION_FAILED",
          operation: "migrate",
          slot: key,
          message: `Migration ${v} → ${v + 1} threw. The previous committed value is unchanged.`,
          cause,
        });
      }
    }
    let validated: T;
    try {
      validated = validate(cursor);
    } catch (cause) {
      throw new DurableError({
        code: "STATE_INVALID",
        operation: "migrate",
        slot: key,
        message: "Migrated value failed validation.",
        cause,
      });
    }
    assertDurableValue(validated, "migrate", key);
    const committed = await withReadWrite(key, "migrate", (current) => {
      // Only commit the migration if the current stored state still
      // matches what we migrated from; another tab may have written
      // between our read and our commit.
      if (current === null || current.stateVersion >= targetVersion) {
        return { next: current, result: current };
      }
      const next: StoredEnvelope<T> = {
        protocolVersion: PROTOCOL_VERSION,
        stateVersion: targetVersion,
        revision: current.revision + 1,
        updatedAt: nowIso(),
        value: validated,
      };
      return { next, result: next };
    });
    if (committed === null) {
      throw new DurableError({
        code: "COMMIT_FAILED",
        operation: "migrate",
        slot: key,
        message: "Migration commit produced a null envelope.",
      });
    }
    return {
      value: committed.value as T,
      revision: committed.revision,
      source: "migration",
    };
  }

  // Same version — validate and return.
  let validated: T;
  try {
    validated = validate(existing.value);
  } catch (cause) {
    throw new DurableError({
      code: "STATE_INVALID",
      operation: "open",
      slot: key,
      message: "Stored value failed validation. Not automatically discarded.",
      cause,
    });
  }
  assertDurableValue(validated, "open", key);
  return { value: validated, revision: existing.revision, source: null };
}

export async function openSlot<T extends DurableValue>(
  namespace: string,
  name: string,
  options: OpenSlotOptions<T>,
): Promise<Slot<T>> {
  assertSlotName(name, "open");
  const key = slotKey(namespace, name);
  const existing = registry.get(key);
  if (existing !== undefined) {
    if (existing.destroyed) {
      registry.delete(key);
    } else {
      existing.handles += 1;
      return existing.slot as unknown as Slot<T>;
    }
  }

  const targetVersion = options.version ?? DEFAULT_STATE_VERSION;
  const validate = options.validate ?? ((value: unknown) => value as T);
  const initial = await loadAndMigrate<T>(key, options);

  let value: T = initial.value;
  let revision = initial.revision;
  const listeners = new Set<(value: T, event: SubscribeEvent) => void>();
  const emit = (event: SubscribeEvent): void => {
    for (const listener of listeners) {
      try {
        listener(value, event);
      } catch {
        /* isolate subscriber failures */
      }
    }
  };
  if (initial.source !== null) {
    // Announce the migration commit to same-process subscribers on the
    // next tick so they see a mounted handle when the event fires.
    queueMicrotask(() =>
      emit({ revision, source: initial.source as CommitSource }),
    );
  }

  const commit = async (
    operation: DurableOperation,
    updater: (current: T) => T | null,
    source: CommitSource,
  ): Promise<void> => {
    const result = await withReadWrite<{ next: T | null; revision: number } | null>(
      key,
      operation,
      (current) => {
        if (current === null) {
          if (operation === "destroy") {
            return { next: null, result: null };
          }
          if (operation === "reset") {
            const seeded: StoredEnvelope<T> = {
              protocolVersion: PROTOCOL_VERSION,
              stateVersion: targetVersion,
              revision: 1,
              updatedAt: nowIso(),
              value: options.initial,
            };
            return {
              next: seeded,
              result: { next: seeded.value as T, revision: seeded.revision },
            };
          }
          throw new DurableError({
            code: "SLOT_DESTROYED",
            operation,
            slot: key,
            message:
              "Slot was destroyed while a write was in-flight. Reopen the slot before writing again.",
          });
        }
        const nextValue = updater(current.value as T);
        if (nextValue === null) {
          return { next: null, result: null };
        }
        assertDurableValue(nextValue, operation, key);
        let validated: T;
        try {
          validated = validate(nextValue);
        } catch (cause) {
          throw new DurableError({
            code: "STATE_INVALID",
            operation,
            slot: key,
            message: "Next value failed validation; commit aborted.",
            cause,
          });
        }
        assertDurableValue(validated, operation, key);
        const nextEnvelope: StoredEnvelope<T> = {
          protocolVersion: PROTOCOL_VERSION,
          stateVersion: targetVersion,
          revision: current.revision + 1,
          updatedAt: nowIso(),
          value: validated,
        };
        return {
          next: nextEnvelope,
          result: { next: validated, revision: nextEnvelope.revision },
        };
      },
    );
    if (result === null) {
      const entry = registry.get(key);
      if (entry !== undefined) entry.destroyed = true;
      return;
    }
    value = result.next as T;
    revision = result.revision;
    emit({ revision, source });
    publish({ slot: key, revision, source });
  };

  const slot: InternalSlot<T> = {
    name,
    stateVersion: targetVersion,
    get value() {
      return value;
    },
    get revision() {
      return revision;
    },
    async set(next) {
      assertDurableValue(next, "set", key);
      await commit("set", () => next, "local");
    },
    async update(updater) {
      await commit(
        "update",
        (current) => updater(current),
        "local",
      );
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async reset() {
      await commit(
        "reset",
        () => options.initial,
        "reset",
      );
    },
    async destroy() {
      await commit("destroy", () => null, "local");
    },
    __close() {
      listeners.clear();
    },
  };

  const disposers: (() => void)[] = [];
  disposers.push(
    subscribeToBroadcast(async (notice: CommitNotice) => {
      if (notice.slot !== key) return;
      if (notice.revision <= revision) return;
      // Reconcile against storage — the notification is a poke, not a
      // source of truth. WebKit may have dropped messages, so revisions
      // may skip; the read below tells us what actually happened.
      const envelope = await readEnvelope(key, "open");
      if (envelope === null) {
        const entry = registry.get(key);
        if (entry !== undefined) entry.destroyed = true;
        return;
      }
      if (envelope.revision <= revision) return;
      try {
        const validated = validate(envelope.value);
        assertDurableValue(validated, "open", key);
        value = validated;
        revision = envelope.revision;
        emit({ revision, source: notice.source });
      } catch {
        /* invalid state from another tab — ignore quietly */
      }
    }),
  );
  disposers.push(
    subscribeToPageshowPoke(async () => {
      const envelope = await readEnvelope(key, "open");
      if (envelope === null || envelope.revision <= revision) return;
      try {
        const validated = validate(envelope.value);
        assertDurableValue(validated, "open", key);
        value = validated;
        revision = envelope.revision;
        emit({ revision, source: "external" });
      } catch {
        /* ignore */
      }
    }),
  );

  registry.set(key, {
    slot: slot as unknown as InternalSlot<DurableValue>,
    handles: 1,
    disposers,
    destroyed: false,
  });

  return slot;
}

