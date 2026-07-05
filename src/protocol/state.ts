import { DurableError, type DurableOperation } from "../errors.js";
import type { DurableValue } from "./types.js";

/**
 * Reject non-JSON-compatible values at the boundary. IDB's structured
 * clone would happily accept Date, Blob, Map, Set — but v1's contract
 * is JSON only, and lying about the shape now would trap consumers
 * later. Cycles are caught by tracking visited references.
 */
export function assertDurableValue(
  value: unknown,
  operation: DurableOperation,
  slot?: string,
): asserts value is DurableValue {
  const seen = new WeakSet<object>();
  visit(value, [], operation, slot, seen);
}

function visit(
  value: unknown,
  path: string[],
  operation: DurableOperation,
  slot: string | undefined,
  seen: WeakSet<object>,
): void {
  if (value === null) return;
  const type = typeof value;
  if (type === "boolean" || type === "string") return;
  if (type === "number") {
    if (!Number.isFinite(value)) {
      reject(operation, slot, path, "NaN or Infinity is not a durable value");
    }
    return;
  }
  if (type === "undefined") {
    reject(operation, slot, path, "undefined is not a durable value");
  }
  if (type === "function") {
    reject(operation, slot, path, "functions are not durable values");
  }
  if (type === "bigint") {
    reject(
      operation,
      slot,
      path,
      "bigint is not part of the v1 durable value contract",
    );
  }
  if (type === "symbol") {
    reject(operation, slot, path, "symbols are not durable values");
  }
  if (type !== "object") {
    reject(operation, slot, path, `unsupported value type: ${type}`);
  }
  const object = value as object;
  if (seen.has(object)) {
    reject(operation, slot, path, "cyclic references are not durable values");
  }
  seen.add(object);
  if (Array.isArray(object)) {
    for (let i = 0; i < object.length; i += 1) {
      visit(object[i], [...path, String(i)], operation, slot, seen);
    }
    return;
  }
  const proto = Object.getPrototypeOf(object);
  if (proto !== null && proto !== Object.prototype) {
    reject(
      operation,
      slot,
      path,
      "only plain objects are durable values (no class instances, Date, Map, Set, Blob, etc.)",
    );
  }
  for (const key of Object.keys(object)) {
    visit(
      (object as Record<string, unknown>)[key],
      [...path, key],
      operation,
      slot,
      seen,
    );
  }
}

function reject(
  operation: DurableOperation,
  slot: string | undefined,
  path: string[],
  reason: string,
): never {
  const at = path.length === 0 ? "" : ` at value.${path.join(".")}`;
  throw new DurableError({
    code: "UNSUPPORTED_VALUE",
    operation,
    ...(slot !== undefined ? { slot } : {}),
    message: `Value cannot be stored${at}: ${reason}`,
  });
}
