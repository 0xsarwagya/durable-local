import {
  describeStorage,
  requestPersistence,
  type DurabilityStatus,
} from "../storage/persistence.js";
import type { DurableValue } from "../protocol/types.js";
import {
  openSlot,
  type OpenSlotOptions,
  type Slot,
} from "./slot.js";

export interface CreateDurableOptions {
  /**
   * Namespace prefix for every slot opened by this instance. Applications
   * with more than one durable-local instance can pass different namespaces
   * to keep their state separate inside the same origin's IDB store.
   */
  namespace?: string;
}

export interface Durable {
  /** The namespace this instance opens slots under. */
  readonly namespace: string;
  /** Open (or re-open) a slot by name. */
  open<T extends DurableValue>(
    name: string,
    options: OpenSlotOptions<T>,
  ): Promise<Slot<T>>;
  /** Honest report of the current storage environment's durability. */
  storage(): Promise<DurabilityStatus>;
  /** Ask the browser to escalate storage to persistent mode. */
  requestPersistence(): Promise<boolean>;
}

const DEFAULT_NAMESPACE = "default";

export function createDurable(options: CreateDurableOptions = {}): Durable {
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;
  return {
    namespace,
    open(name, opts) {
      return openSlot(namespace, name, opts);
    },
    storage() {
      return describeStorage();
    },
    requestPersistence() {
      return requestPersistence();
    },
  };
}
