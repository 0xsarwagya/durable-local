import { BROADCAST_CHANNEL_NAME } from "../protocol/constants.js";
import type { CommitNotice } from "../protocol/types.js";

/**
 * BroadcastChannel wrapper. The channel is a hint, never the source of
 * truth — WebKit silently drops messages to bfcached pages, so every
 * subscriber must reconcile against IDB on pageshow. The `pageshow`
 * hook here forwards a "poke" to subscribers so they can re-read the
 * committed revision even when they missed messages.
 */

type Listener = (notice: CommitNotice) => void;
type PokeListener = () => void;

let channel: BroadcastChannel | null = null;
const listeners = new Set<Listener>();
const pokeListeners = new Set<PokeListener>();

function ensureChannel(): BroadcastChannel | null {
  if (channel !== null) return channel;
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
  } catch {
    return null;
  }
  channel.onmessage = (event) => {
    const data = event.data as Partial<CommitNotice> | undefined;
    if (
      data === undefined ||
      typeof data.slot !== "string" ||
      typeof data.revision !== "number"
    ) {
      return;
    }
    const notice: CommitNotice = {
      slot: data.slot,
      revision: data.revision,
      source: data.source ?? "external",
    };
    for (const listener of listeners) {
      try {
        listener(notice);
      } catch {
        /* one bad subscriber must not silence the rest */
      }
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("pageshow", (event) => {
      // bfcache restore: WebKit may have dropped messages while we were
      // frozen. Poke every subscriber so they re-read from IDB.
      if ((event as PageTransitionEvent).persisted) {
        for (const listener of pokeListeners) {
          try {
            listener();
          } catch {
            /* isolate failures */
          }
        }
      }
    });
  }
  return channel;
}

/** Publish a commit notice. No-op if the channel is unavailable. */
export function publish(notice: CommitNotice): void {
  const ch = ensureChannel();
  if (ch === null) return;
  try {
    ch.postMessage(notice);
  } catch {
    /* posts fail on closed channels — recover silently */
  }
}

/** Subscribe to commit notices from other browsing contexts. */
export function subscribe(listener: Listener): () => void {
  ensureChannel();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Subscribe to "the page just resumed from bfcache; you might have
 * missed messages, please reconcile against storage now."
 */
export function subscribeToPageshowPoke(listener: PokeListener): () => void {
  ensureChannel();
  pokeListeners.add(listener);
  return () => {
    pokeListeners.delete(listener);
  };
}

/** Test seam. */
export function __resetForTests(): void {
  channel?.close();
  channel = null;
  listeners.clear();
  pokeListeners.clear();
}
