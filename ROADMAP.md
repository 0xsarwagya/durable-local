# Roadmap

The package is small on purpose. This roadmap is the shortlist of things
that might arrive; more importantly, it is the shortlist of things I have
decided will not.

## 0.1 — the survival release (current)

The whole v1 contract, proven across engines:

- Named slots (`open` / `value` / `set` / `update` / `subscribe` /
  `reset` / `destroy`).
- Atomic commits inside a single `readwrite` IndexedDB transaction;
  synchronous updater required so WebKit does not close the transaction
  under us.
- Explicit application state versions with sequential migrations.
  Failed migrations preserve the previous committed value; stored state
  from a future version rejects safely.
- Runtime validation hook that runs after read, after migration, and
  before every commit.
- Cross-tab observation via `BroadcastChannel`, reconciled against IDB
  on bfcache restore because WebKit silently drops messages to frozen
  pages.
- Honest durability status: `evictionRisk` names Safari's ITP 7-day cap
  distinctly from "persistent" so applications can prompt users to
  install as a Home Screen web app when it matters.
- Playwright matrix across Chromium, Firefox, and WebKit.

## 0.2 — proposed

- **Storage Buckets** on Chromium — smaller-scope quota + persistence
  requests that do not cover the whole origin. Cross-browser story is
  still Chromium-only in 2026 so this stays proposed.
- **Streaming subscribers** — subscribe with a starting revision and
  receive every committed value newer than that. Useful when tabs
  hydrate at slightly different revisions and want to catch up.

## 0.3 — proposed

- **Bulk API for many slots** if measurement shows the per-slot overhead
  is real. Right now every slot is one record and `getAll()` is fast
  enough.

## Explicitly not shipping

- **Adapters.** No `StorageAdapter`, no `LocalStorageAdapter`, no
  memory fallback. There is one implementation. A public adapter
  interface exists only when a second real implementation earns it,
  and no candidate has earned it.
- **Snapshot / restore.** Removed from the PRD. It was smuggled in by
  a different product idea; if it belongs anywhere, it belongs there.
- **Queries, collections, indexes, joins.** The answer to any of these
  is "use a database."
- **Sync.** Between devices, between users, between tabs beyond
  observation. Handoff moves state between devices when a user asks;
  durable-local keeps it here.
- **Encryption.** Storage without server-side key management is
  theatre. If you need it, use a real key-management system.
- **React (or any framework) integration.** The API is small enough
  that wrapping it takes fewer lines than a peer dependency would.

## How to nudge this

Open an issue on
[`0xsarwagya/durable-local`](https://github.com/0xsarwagya/durable-local/issues)
with the real use case. "I want to be able to X" beats "please add Y."
