import { describe, expect, it } from "vitest";

import { createDurable } from "../src/core/durable.js";
import { isDurableError } from "../src/errors.js";

type Workspace = {
  title: string;
  blocks: { id: string; text: string }[];
};

const INITIAL: Workspace = { title: "Untitled", blocks: [] };

function fresh() {
  return createDurable({ namespace: `t-${Math.random().toString(36).slice(2)}` });
}

describe("slot lifecycle", () => {
  it("returns initial value on first open, and set() persists across reopen", async () => {
    const durable = fresh();
    const a = await durable.open<Workspace>("workspace", { initial: INITIAL });
    expect(a.value).toEqual(INITIAL);
    expect(a.revision).toBe(1);

    await a.set({ title: "Hello", blocks: [{ id: "b1", text: "hi" }] });
    expect(a.value.title).toBe("Hello");
    expect(a.revision).toBe(2);

    // Simulate reload: drop in-process handles, reopen from the same namespace.
    __simulateReload();
    const b = await createDurable({ namespace: durable.namespace }).open<Workspace>(
      "workspace",
      { initial: INITIAL },
    );
    expect(b.value.title).toBe("Hello");
    expect(b.revision).toBe(2);
  });

  it("update() is atomic (concurrent updates do not lose writes)", async () => {
    const durable = fresh();
    const slot = await durable.open<{ count: number }>("counter", {
      initial: { count: 0 },
    });
    const N = 25;
    await Promise.all(
      Array.from({ length: N }, () =>
        slot.update((c) => ({ count: c.count + 1 })),
      ),
    );
    expect(slot.value.count).toBe(N);
    expect(slot.revision).toBe(N + 1);
  });

  it("subscribers only see committed values", async () => {
    const durable = fresh();
    const slot = await durable.open<{ n: number }>("s", { initial: { n: 0 } });
    const seen: number[] = [];
    slot.subscribe((value) => {
      seen.push(value.n);
    });
    await slot.set({ n: 1 });
    await slot.set({ n: 2 });
    await slot.update((c) => ({ n: c.n + 1 }));
    expect(seen).toEqual([1, 2, 3]);
  });

  it("reset() re-seeds and increments revision", async () => {
    const durable = fresh();
    const slot = await durable.open<Workspace>("w", { initial: INITIAL });
    await slot.set({ title: "Modified", blocks: [] });
    const before = slot.revision;
    await slot.reset();
    expect(slot.value).toEqual(INITIAL);
    expect(slot.revision).toBe(before + 1);
  });

  it("destroy() removes the slot; a later open behaves as first open", async () => {
    const durable = fresh();
    const a = await durable.open<Workspace>("w", { initial: INITIAL });
    await a.set({ title: "Changed", blocks: [] });
    await a.destroy();

    __simulateReload();
    const b = await createDurable({
      namespace: durable.namespace,
    }).open<Workspace>("w", { initial: INITIAL });
    expect(b.value).toEqual(INITIAL);
    expect(b.revision).toBe(1);
  });

  it("rejects invalid slot names", async () => {
    const durable = fresh();
    try {
      await durable.open("BadName!", { initial: INITIAL });
      expect.fail("should have thrown");
    } catch (err) {
      if (!isDurableError(err)) throw err;
      expect(err.code).toBe("SLOT_NAME_INVALID");
    }
  });
});

describe("slot migration", () => {
  it("runs sequential migrations and preserves old value on failure", async () => {
    const durable = fresh();

    // Seed at version 1.
    const v1 = await durable.open<{ count: number }>("m", {
      initial: { count: 10 },
      version: 1,
    });
    await v1.set({ count: 42 });

    __simulateReload();
    const v3 = await createDurable({
      namespace: durable.namespace,
    }).open<{ count: number; label: string; touched: number }>("m", {
      initial: { count: 0, label: "", touched: 0 },
      version: 3,
      migrations: {
        1: (v) => ({
          ...(v as { count: number }),
          label: "migrated",
        }),
        2: (v) => ({
          ...(v as { count: number; label: string }),
          touched: 1,
        }),
      },
    });
    expect(v3.value.count).toBe(42);
    expect(v3.value.label).toBe("migrated");
    expect(v3.value.touched).toBe(1);
  });

  it("throws MIGRATION_REQUIRED when a step is missing", async () => {
    const durable = fresh();
    const seed = await durable.open<{ n: number }>("m2", {
      initial: { n: 1 },
      version: 1,
    });
    await seed.set({ n: 2 });

    __simulateReload();
    try {
      await createDurable({ namespace: durable.namespace }).open("m2", {
        initial: { n: 0 },
        version: 3,
        migrations: {}, // missing 1→2 and 2→3
      });
      expect.fail("should have thrown");
    } catch (err) {
      if (!isDurableError(err)) throw err;
      expect(err.code).toBe("MIGRATION_REQUIRED");
    }
  });

  it("throws FUTURE_VERSION when stored state is ahead of the build", async () => {
    const durable = fresh();
    const v3 = await durable.open<{ n: number }>("future", {
      initial: { n: 1 },
      version: 3,
    });
    await v3.set({ n: 9 });

    __simulateReload();
    try {
      await createDurable({ namespace: durable.namespace }).open("future", {
        initial: { n: 0 },
        version: 1,
      });
      expect.fail("should have thrown");
    } catch (err) {
      if (!isDurableError(err)) throw err;
      expect(err.code).toBe("FUTURE_VERSION");
    }
  });

  it("throws MIGRATION_FAILED and does not corrupt storage", async () => {
    const durable = fresh();
    const seed = await durable.open<{ n: number }>("mf", {
      initial: { n: 1 },
      version: 1,
    });
    await seed.set({ n: 100 });

    __simulateReload();
    try {
      await createDurable({ namespace: durable.namespace }).open("mf", {
        initial: { n: 0 },
        version: 2,
        migrations: {
          1: () => {
            throw new Error("boom");
          },
        },
      });
      expect.fail("should have thrown");
    } catch (err) {
      if (!isDurableError(err)) throw err;
      expect(err.code).toBe("MIGRATION_FAILED");
    }

    // Old value survives a failed migration.
    __simulateReload();
    const reopened = await createDurable({
      namespace: durable.namespace,
    }).open<{ n: number }>("mf", { initial: { n: 0 }, version: 1 });
    expect(reopened.value.n).toBe(100);
  });
});

describe("validation", () => {
  it("STATE_INVALID when stored state fails the validator", async () => {
    const durable = fresh();
    const raw = await durable.open<Workspace>("v", { initial: INITIAL });
    await raw.set({ title: "ok", blocks: [] });

    __simulateReload();
    try {
      await createDurable({ namespace: durable.namespace }).open<Workspace>("v", {
        initial: INITIAL,
        validate: (value) => {
          const w = value as Workspace;
          if (typeof w.title !== "string" || w.title === "ok") {
            throw new Error("invalid");
          }
          return w;
        },
      });
      expect.fail("should have thrown");
    } catch (err) {
      if (!isDurableError(err)) throw err;
      expect(err.code).toBe("STATE_INVALID");
    }
  });
});
