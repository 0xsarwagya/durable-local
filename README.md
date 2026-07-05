# durable-local

Named durable values for the browser.

A TypeScript library that gives a browser tab one thing: an application
value that survives close and reload. No database, no state manager, no
sync engine. The application owns the value. The package owns its
survival.

## Install

```
pnpm add @0xsarwagya/durable-local
```

## Use

```ts
import { createDurable } from "@0xsarwagya/durable-local";

const durable = createDurable();

const workspace = await durable.open("workspace", {
  initial: { title: "Untitled", blocks: [] },
});

workspace.value; // { title: "Untitled", blocks: [] }

await workspace.update((current) => ({
  ...current,
  title: "Something",
}));

// Close the tab. Come back tomorrow. Still there.
```

Every commit is atomic — subscribers only see values that survived a
successful IndexedDB transaction. Cross-tab observation is built in.

## Boundaries

- **Not a database.** No queries, collections, indexes, joins.
- **Not a state manager.** No actions, reducers, middleware.
- **Not sync.** State stays on the device; the package does not touch
  the network.
- **Not encryption.** Storage is not confidentiality.

If you need any of those, this package is not what you want.

## Guarantees

- Committed values survive reload.
- Failed writes preserve the previous committed value.
- Concurrent updates do not silently overwrite one another.
- Migration failure preserves the previous committed value.
- Cross-tab commits are eventually observed.
- Invalid stored state is never returned as `T`.

## Browsers

Runs on IndexedDB. Tested on every commit in Chromium, Firefox, and
WebKit via Playwright.

## Used in Local

[Local](https://local.sarwagya.wtf) uses `durable-local` to keep each
peer's chat history alive across reloads. One slot per peer, one
`update()` per received message, atomic commits, no database. If the
peer's public key changes on reconnect, the slot refuses to attach —
that pinning is the only thing between recovered identity and silent
peer substitution.

Source: [github.com/0xsarwagya/local](https://github.com/0xsarwagya/local)

## Docs and demo

- Docs: https://oss.sarwagya.wtf/durable-local/docs
- Demo: https://oss.sarwagya.wtf/durable-local/demo

## License

MIT.
