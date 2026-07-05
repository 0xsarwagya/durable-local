import { expect, test } from "@playwright/test";

/// <reference path="./globals.d.ts" />

/**
 * The lifecycle gate — the release proof.
 *
 * open() → set() → reload → same value.
 * update() atomicity across many concurrent calls on the same page.
 * reset() re-seeds and increments the revision.
 * destroy() removes the slot; a subsequent open() sees the initial value.
 */
test.describe("slot lifecycle", () => {
  test("survives reload with the exact value that was set", async ({ page }) => {
    const ns = `lc-${Math.random().toString(36).slice(2)}`;
    await page.goto(`/lifecycle.html?ns=${ns}`);
    await page.waitForFunction(() => window.__done === true, undefined, {
      timeout: 10_000,
    });

    const first = await page.evaluate(() =>
      window.__setTitle!("Persistent title"),
    );
    expect(first.revision).toBe(2);
    expect(first.value.title).toBe("Persistent title");

    await page.goto(`/lifecycle.html?ns=${ns}`);
    await page.waitForFunction(() => window.__done === true, undefined, {
      timeout: 10_000,
    });

    const reopened = await page.evaluate(() => window.__seed!());
    expect(reopened.revision).toBe(2);
    expect((reopened.value as { title: string }).title).toBe(
      "Persistent title",
    );
  });

  test("update() is atomic across many concurrent calls", async ({ page }) => {
    const ns = `atomic-${Math.random().toString(36).slice(2)}`;
    await page.goto(`/lifecycle.html?ns=${ns}`);
    await page.waitForFunction(() => window.__done === true, undefined, {
      timeout: 10_000,
    });

    const N = 20;
    const final = await page.evaluate(async (count) => {
      await Promise.all(
        Array.from({ length: count }, (_, i) =>
          window.__updateAppend!({ id: `b${i}`, text: `Block ${i}` }),
        ),
      );
      const state = await window.__updateAppend!({ id: "done", text: "done" });
      return state;
    }, N);

    expect(final.value.blocks).toHaveLength(N + 1);
    expect(final.revision).toBeGreaterThanOrEqual(N + 2);
  });

  test("reset() re-seeds and bumps the revision", async ({ page }) => {
    const ns = `reset-${Math.random().toString(36).slice(2)}`;
    await page.goto(`/lifecycle.html?ns=${ns}`);
    await page.waitForFunction(() => window.__done === true, undefined, {
      timeout: 10_000,
    });

    await page.evaluate(() => window.__setTitle!("Modified"));
    const after = await page.evaluate(() => window.__reset!());
    expect((after.value as { title: string }).title).toBe("Untitled");
    expect(after.revision).toBeGreaterThan(1);
  });

  test("destroy() clears the slot; next open sees the fixture's initial", async ({
    page,
  }) => {
    const ns = `destroy-${Math.random().toString(36).slice(2)}`;
    await page.goto(`/lifecycle.html?ns=${ns}`);
    await page.waitForFunction(() => window.__done === true, undefined, {
      timeout: 10_000,
    });

    await page.evaluate(() => window.__setTitle!("About to go"));
    await page.evaluate(() => window.__destroy!());

    // Reload — the same slot in a fresh registry should behave like a
    // first open and get the fixture's INITIAL back.
    await page.goto(`/lifecycle.html?ns=${ns}`);
    await page.waitForFunction(() => window.__done === true, undefined, {
      timeout: 10_000,
    });
    const seeded = await page.evaluate(() => window.__seed!());
    expect((seeded.value as { title: string }).title).toBe("Untitled");
    expect(seeded.revision).toBe(1);
  });
});
