import { DurableError, type DurableOperation } from "../errors.js";
import { DB_NAME, STORE_NAME } from "../protocol/constants.js";
import type { StoredEnvelope } from "../protocol/types.js";

/**
 * IndexedDB is not called directly anywhere else. This file owns the
 * database connection, translates DOMExceptions into typed errors, and
 * exposes exactly one primitive — `withReadWrite(slot, fn)` — which is
 * the only path the rest of the library uses to mutate storage.
 *
 * The fn is invoked SYNCHRONOUSLY inside the transaction's active window.
 * Awaiting a non-IDB promise inside fn would auto-commit the transaction
 * (WebKit is the strictest here), so the primitive prevents it by
 * requiring fn to return a plain value, not a promise.
 */

let openDb: Promise<IDBDatabase> | null = null;

function isSupported(): boolean {
  return (
    typeof indexedDB !== "undefined" &&
    typeof indexedDB.open === "function"
  );
}

function requireSupport(operation: DurableOperation): void {
  if (!isSupported()) {
    throw new DurableError({
      code: "UNSUPPORTED",
      operation,
      message:
        "IndexedDB is not available in this runtime. durable-local requires a browser with a working IDB implementation.",
    });
  }
}

function openDatabase(operation: DurableOperation): Promise<IDBDatabase> {
  requireSupport(operation);
  if (openDb !== null) return openDb;
  openDb = new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, 1);
    } catch (cause) {
      openDb = null;
      reject(
        new DurableError({
          code: "STORAGE_UNAVAILABLE",
          operation,
          message: "IndexedDB.open() threw synchronously.",
          cause,
        }),
      );
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // If another tab initiates an upgrade, close our connection so it
      // is not the reason the upgrade cannot proceed. The library does
      // not support live schema migration across versions in a running
      // page — reload picks up the new version.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => {
      openDb = null;
      reject(
        new DurableError({
          code: "STORAGE_UNAVAILABLE",
          operation,
          message: `IndexedDB.open() failed: ${describe(request.error)}`,
          cause: request.error ?? undefined,
        }),
      );
    };
    request.onblocked = () => {
      openDb = null;
      reject(
        new DurableError({
          code: "STORAGE_UNAVAILABLE",
          operation,
          message:
            "IndexedDB.open() is blocked by another tab holding an older version of the database.",
        }),
      );
    };
  });
  return openDb;
}

export async function readEnvelope(
  slot: string,
  operation: DurableOperation,
): Promise<StoredEnvelope | null> {
  const db = await openDatabase(operation);
  return new Promise((resolve, reject) => {
    let txn: IDBTransaction;
    try {
      txn = db.transaction(STORE_NAME, "readonly");
    } catch (cause) {
      reject(
        new DurableError({
          code: "STORAGE_UNAVAILABLE",
          operation,
          slot,
          message: "Could not open readonly transaction.",
          cause,
        }),
      );
      return;
    }
    const request = txn.objectStore(STORE_NAME).get(slot);
    request.onsuccess = () => {
      const raw = request.result as StoredEnvelope | undefined;
      resolve(raw ?? null);
    };
    request.onerror = () => {
      reject(
        new DurableError({
          code: "OPEN_FAILED",
          operation,
          slot,
          message: `Read failed: ${describe(request.error)}`,
          cause: request.error ?? undefined,
        }),
      );
    };
  });
}

/**
 * Perform a synchronous read-modify-write inside one atomic transaction.
 *
 * The updater is invoked with the current envelope (or null on first
 * write). It must return the next envelope synchronously. Any thrown
 * error aborts the transaction; the previously committed value remains.
 *
 * WebKit will auto-commit the transaction if any non-IDB promise is
 * awaited between the read and the write; that's why the updater is
 * required to be synchronous.
 */
export async function withReadWrite<T>(
  slot: string,
  operation: DurableOperation,
  updater: (current: StoredEnvelope | null) => {
    next: StoredEnvelope | null;
    result: T;
  },
): Promise<T> {
  const db = await openDatabase(operation);
  return new Promise((resolve, reject) => {
    let txn: IDBTransaction;
    try {
      txn = db.transaction(STORE_NAME, "readwrite");
    } catch (cause) {
      reject(
        new DurableError({
          code: "STORAGE_UNAVAILABLE",
          operation,
          slot,
          message: "Could not open readwrite transaction.",
          cause,
        }),
      );
      return;
    }
    const store = txn.objectStore(STORE_NAME);
    const readRequest = store.get(slot);
    let outcome: { next: StoredEnvelope | null; result: T } | null = null;
    let updaterError: unknown = null;

    readRequest.onsuccess = () => {
      const current = (readRequest.result as StoredEnvelope | undefined) ?? null;
      try {
        outcome = updater(current);
      } catch (err) {
        updaterError = err;
        try {
          txn.abort();
        } catch {
          /* txn may already be aborting */
        }
        return;
      }
      if (outcome.next === null) {
        const del = store.delete(slot);
        del.onerror = () => {
          updaterError = new DurableError({
            code: "COMMIT_FAILED",
            operation,
            slot,
            message: `Delete failed: ${describe(del.error)}`,
            cause: del.error ?? undefined,
          });
          try {
            txn.abort();
          } catch {
            /* already aborting */
          }
        };
        return;
      }
      const put = store.put(outcome.next, slot);
      put.onerror = () => {
        updaterError = classifyPutError(put.error, operation, slot);
        try {
          txn.abort();
        } catch {
          /* already aborting */
        }
      };
    };
    readRequest.onerror = () => {
      updaterError = new DurableError({
        code: "COMMIT_FAILED",
        operation,
        slot,
        message: `Read inside readwrite failed: ${describe(readRequest.error)}`,
        cause: readRequest.error ?? undefined,
      });
      try {
        txn.abort();
      } catch {
        /* already aborting */
      }
    };

    txn.oncomplete = () => {
      if (outcome === null) {
        reject(
          updaterError ??
            new DurableError({
              code: "COMMIT_FAILED",
              operation,
              slot,
              message: "Transaction completed without producing an outcome.",
            }),
        );
        return;
      }
      resolve(outcome.result);
    };
    txn.onabort = () => {
      reject(
        updaterError ??
          classifyTxnError(txn.error, operation, slot),
      );
    };
    txn.onerror = () => {
      // Do nothing here — onabort will fire and handle rejection with a
      // consistent error, avoiding double-reject.
    };
  });
}

function classifyPutError(
  error: DOMException | null,
  operation: DurableOperation,
  slot: string,
): DurableError {
  if (error && (error.name === "QuotaExceededError" || error.code === 22)) {
    return new DurableError({
      code: "QUOTA_EXCEEDED",
      operation,
      slot,
      message: "Browser storage quota exceeded; the write was rolled back.",
      cause: error,
    });
  }
  return new DurableError({
    code: "COMMIT_FAILED",
    operation,
    slot,
    message: `Write failed: ${describe(error)}`,
    ...(error !== null ? { cause: error } : {}),
  });
}

function classifyTxnError(
  error: DOMException | null,
  operation: DurableOperation,
  slot: string,
): DurableError {
  if (error && (error.name === "QuotaExceededError" || error.code === 22)) {
    return new DurableError({
      code: "QUOTA_EXCEEDED",
      operation,
      slot,
      message: "Browser storage quota exceeded; the write was rolled back.",
      cause: error,
    });
  }
  return new DurableError({
    code: "COMMIT_FAILED",
    operation,
    slot,
    message: `Transaction aborted: ${describe(error)}`,
    ...(error !== null ? { cause: error } : {}),
  });
}

function describe(error: DOMException | null | undefined): string {
  if (!error) return "unknown error";
  return `${error.name}: ${error.message}`;
}

/** Test seam — resets the cached open() promise. Not part of the public API. */
export function __resetForTests(): void {
  openDb = null;
}
