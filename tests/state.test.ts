import { describe, expect, it } from "vitest";

import { isDurableError } from "../src/errors.js";
import { assertDurableValue } from "../src/protocol/state.js";

function expectRejection(value: unknown, needle: RegExp): void {
  try {
    assertDurableValue(value, "set", "x");
    expect.fail(`expected rejection matching ${needle}`);
  } catch (err) {
    if (!isDurableError(err)) throw err;
    expect(err.code).toBe("UNSUPPORTED_VALUE");
    expect(err.message).toMatch(needle);
  }
}

describe("assertDurableValue", () => {
  it("accepts JSON primitives, arrays, and plain objects", () => {
    assertDurableValue(null, "set", "x");
    assertDurableValue(true, "set", "x");
    assertDurableValue(42, "set", "x");
    assertDurableValue("hi", "set", "x");
    assertDurableValue([1, "two", { three: [4] }, null], "set", "x");
    assertDurableValue({ a: { b: { c: [] } } }, "set", "x");
  });

  it("rejects undefined, symbols, bigints, functions", () => {
    expectRejection(undefined, /undefined/);
    expectRejection(Symbol("s"), /symbols/);
    expectRejection(BigInt(1), /bigint/);
    expectRejection(() => 1, /functions/);
  });

  it("rejects NaN and Infinity", () => {
    expectRejection(NaN, /NaN or Infinity/);
    expectRejection(Number.POSITIVE_INFINITY, /NaN or Infinity/);
  });

  it("rejects class instances, Date, Map, Set, Blob", () => {
    class Foo {}
    expectRejection(new Foo(), /only plain objects/);
    expectRejection(new Date(), /only plain objects/);
    expectRejection(new Map(), /only plain objects/);
    expectRejection(new Set(), /only plain objects/);
  });

  it("rejects cycles", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expectRejection(a, /cyclic/);
  });
});
