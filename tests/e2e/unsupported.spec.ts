import { expect, test } from "@playwright/test";

import "./globals";

/**
 * A runtime without IndexedDB must surface a typed UNSUPPORTED error —
 * not throw a mystery TypeError, not silently do nothing. Chromium-only:
 * the code paths are engine-independent.
 */
test("createDurable().open() throws UNSUPPORTED when IndexedDB is unavailable", async ({
  page,
}) => {
  await page.goto("/unsupported.html");
  await page.waitForFunction(() => window.__done === true);
  const result = await page.evaluate(() => window.__result!);

  expect(result.threw).toBe(true);
  expect(result.code).toBe("UNSUPPORTED");
  expect(result.operation).toBe("open");
  expect(result.message).toMatch(/IndexedDB/);

  // storage() must still succeed — it's a runtime probe, and probing
  // must not throw just because IDB is missing.
  expect(result.storageError).toBeUndefined();
  expect(result.storage).toBeDefined();
});
