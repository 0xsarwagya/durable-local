import { expect, test } from "@playwright/test";

/// <reference path="./globals.d.ts" />

/**
 * The cross-tab gate.
 *
 * Two pages open the same slot at the same namespace. Tab A commits.
 * Tab B eventually observes the new revision — via BroadcastChannel
 * primarily, and via the bfcache-safe pageshow reconciliation on
 * WebKit where BroadcastChannel messages to frozen pages get dropped.
 */
test.describe("cross-tab observation", () => {
  test("Tab B observes commits made in Tab A", async ({ browser }) => {
    const ns = `xt-${Math.random().toString(36).slice(2)}`;
    const context = await browser.newContext();
    const a = await context.newPage();
    const b = await context.newPage();

    await a.goto(`/cross-tab.html?ns=${ns}`);
    await b.goto(`/cross-tab.html?ns=${ns}`);
    await a.waitForFunction(() => window.__ready === true);
    await b.waitForFunction(() => window.__ready === true);

    await a.evaluate(() => window.__increment!());
    await a.evaluate(() => window.__increment!());
    await a.evaluate(() => window.__increment!());

    // Give BroadcastChannel a moment; the library will reconcile from
    // IDB whether or not the channel fired.
    await b.waitForFunction(() => window.__revision!() >= 4, undefined, {
      timeout: 10_000,
    });

    const bState = await b.evaluate(() => ({
      value: window.__value!(),
      revision: window.__revision!(),
      events: window.__events!,
    }));
    expect(bState.value.n).toBeGreaterThanOrEqual(3);
    // Should have seen at least one external event (revision > seed).
    const external = bState.events.filter((e) => e.source === "external");
    expect(external.length).toBeGreaterThan(0);

    await context.close();
  });

  test("concurrent updates across tabs do not silently overwrite one another", async ({
    browser,
  }) => {
    const ns = `xt-atomic-${Math.random().toString(36).slice(2)}`;
    const context = await browser.newContext();
    const a = await context.newPage();
    const b = await context.newPage();

    await a.goto(`/cross-tab.html?ns=${ns}`);
    await b.goto(`/cross-tab.html?ns=${ns}`);
    await a.waitForFunction(() => window.__ready === true);
    await b.waitForFunction(() => window.__ready === true);

    // Fire updates from both tabs "at the same time" (as close as
    // JavaScript can get). IDB serializes readwrite transactions with
    // overlapping scope across tabs, so no update should be lost.
    const N = 10;
    await Promise.all([
      a.evaluate(async (count) => {
        for (let i = 0; i < count; i += 1) await window.__increment!();
      }, N),
      b.evaluate(async (count) => {
        for (let i = 0; i < count; i += 1) await window.__increment!();
      }, N),
    ]);

    // Wait for both pages to settle at the true count. Either page must
    // see the final total, not something smaller.
    await a.waitForFunction(
      (target) => window.__value!().n === target,
      2 * N,
      { timeout: 10_000 },
    );
    await b.waitForFunction(
      (target) => window.__value!().n === target,
      2 * N,
      { timeout: 10_000 },
    );

    await context.close();
  });
});
