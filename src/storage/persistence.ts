import { DurableError } from "../errors.js";

/**
 * Realistic eviction category for the current environment.
 *
 *  session      — Firefox Private, Safari Private, Chrome Incognito.
 *                 Wiped at session end. Persist requests do nothing.
 *  ephemeral    — persist() denied AND low engagement. Best-effort
 *                 storage that a browser may evict under pressure.
 *  best-effort  — default box mode. Not persisted, not necessarily
 *                 evicted; the browser decides.
 *  persistent   — persist()=true, Chromium/Firefox regular window OR
 *                 Safari installed webapp. Safe from automatic eviction.
 *  ios-capped   — Safari regular tab with persist()=true. The API says
 *                 yes; ITP still evicts after 7 days of no interaction.
 *                 User must install the site as a Home Screen web app
 *                 for real durability.
 */
export type EvictionRisk =
  | "session"
  | "ephemeral"
  | "best-effort"
  | "persistent"
  | "ios-capped";

export interface DurabilityStatus {
  /**
   * Whether the browser considers this origin's storage persistent.
   * On Safari desktop/iOS this can be true and ITP will still evict —
   * see `evictionRisk` for the honest read.
   */
  persistent: boolean;
  /** navigator.storage.estimate().quota, or null if unavailable. */
  quotaBytes: number | null;
  /** navigator.storage.estimate().usage, or null if unavailable. */
  usageBytes: number | null;
  /** True on Safari and in private modes — the numbers are rounded. */
  quotaRounded: boolean;
  privateMode: "unknown" | "likely" | "no";
  evictionRisk: EvictionRisk;
  engine: "chromium" | "gecko" | "webkit" | "unknown";
  /** True if the page is running as an installed / standalone web app. */
  installedWebApp: boolean;
}

function detectEngine(): DurabilityStatus["engine"] {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  if (/Firefox\//.test(ua)) return "gecko";
  if (/Edg\/|Chrome\/|OPR\/|SamsungBrowser\//.test(ua)) return "chromium";
  if (/Safari\//.test(ua)) return "webkit";
  return "unknown";
}

function detectInstalledWebApp(): boolean {
  if (typeof window === "undefined" || typeof matchMedia === "undefined") {
    return false;
  }
  try {
    if (matchMedia("(display-mode: standalone)").matches) return true;
  } catch {
    /* ignore */
  }
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

function detectPrivateMode(quota: number | null): DurabilityStatus["privateMode"] {
  // Heuristic: private windows report drastically reduced quota. Under
  // ~150 MiB is a strong signal on all three engines in 2026. This is
  // heuristic on purpose — the platform gives no direct probe.
  if (quota === null) return "unknown";
  if (quota < 150 * 1024 * 1024) return "likely";
  return "no";
}

async function readEstimate(): Promise<{
  quota: number | null;
  usage: number | null;
}> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
    return { quota: null, usage: null };
  }
  try {
    const estimate = await navigator.storage.estimate();
    return {
      quota: typeof estimate.quota === "number" ? estimate.quota : null,
      usage: typeof estimate.usage === "number" ? estimate.usage : null,
    };
  } catch {
    return { quota: null, usage: null };
  }
}

async function readPersisted(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persisted) {
    return false;
  }
  try {
    return await navigator.storage.persisted();
  } catch {
    return false;
  }
}

export async function describeStorage(): Promise<DurabilityStatus> {
  const engine = detectEngine();
  const installedWebApp = detectInstalledWebApp();
  const [{ quota, usage }, persistent] = await Promise.all([
    readEstimate(),
    readPersisted(),
  ]);
  const privateMode = detectPrivateMode(quota);
  const quotaRounded = engine === "webkit" || privateMode !== "no";

  let evictionRisk: EvictionRisk;
  if (privateMode === "likely") {
    evictionRisk = "session";
  } else if (persistent) {
    if (engine === "webkit" && !installedWebApp) {
      evictionRisk = "ios-capped";
    } else {
      evictionRisk = "persistent";
    }
  } else {
    evictionRisk = "best-effort";
  }

  return {
    persistent,
    quotaBytes: quota,
    usageBytes: usage,
    quotaRounded,
    privateMode,
    evictionRisk,
    engine,
    installedWebApp,
  };
}

/**
 * Ask the browser to escalate this origin's storage to persistent mode.
 *
 * Semantics vary — Chromium auto-decides silently, Firefox shows a
 * prompt, Safari uses heuristics that mostly favor installed web apps.
 * Never call this unprompted; call it when the user has done something
 * that says "keep this".
 */
export async function requestPersistence(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) {
    throw new DurableError({
      code: "UNSUPPORTED",
      operation: "requestPersistence",
      message: "navigator.storage.persist() is not available in this runtime.",
    });
  }
  try {
    return await navigator.storage.persist();
  } catch (cause) {
    throw new DurableError({
      code: "STORAGE_UNAVAILABLE",
      operation: "requestPersistence",
      message: "navigator.storage.persist() rejected.",
      cause,
    });
  }
}
