/// <reference types="node" />

// Node-side tests need a real IDB implementation. fake-indexeddb ships one
// that follows the spec closely enough to exercise transaction lifecycle,
// versioning, and quota behavior — the parts that actually matter here.
import "fake-indexeddb/auto";

import { __resetForTests as resetBroadcast } from "../src/coordination/broadcast.js";
import { __resetForTests as resetSlots } from "../src/core/slot.js";
import { __resetForTests as resetIdb } from "../src/storage/idb.js";
import { afterEach, beforeEach } from "vitest";

beforeEach(() => {
  resetBroadcast();
  resetSlots();
  resetIdb();
});

// Expose the slot-registry reset globally so individual tests can call it
// to simulate a "reload" between two `createDurable(...).open(...)` calls
// on the same namespace + slot name.
declare global {
  // eslint-disable-next-line no-var
  var __simulateReload: () => void;
}
globalThis.__simulateReload = () => {
  resetSlots();
  resetIdb();
};

afterEach(async () => {
  // Delete the database so every test starts from empty storage.
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase("durable-local");
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
  resetIdb();
});
