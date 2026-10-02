# CLAUDE.md — raidr_extension

> **Git policy — never auto-commit or auto-push.** Leave your work in the working tree.
> Run `git commit`, `git push`, `gh pr create`, or `push_all.sh` **only when the user
> explicitly asks in that turn**. Approval for an earlier change does not carry forward, and
> finishing a task is not permission to commit it.

MV3 Chrome extension that captures a running web app's network traffic and
runtime, and exports it as an raidr bundle.

## Where it sits in the raidr family

- **`raidr_processor`** (npm `@sudobility/raidr_processor`; renamed from
  `raidr_lib` on 2026-09-30) — the pure bundle-format / redaction / coverage
  library this extension imports. Redaction rules live there, not here.
- `raidr_cli` — reconstructs a project from a bundle; ships the agent skill.
- `raidr_crawler` — headless capture (the non-browser-extension path).
- `raidr_types` → `raidr_client` → `raidr_lib` (the *new* business-logic
  package, unrelated to the old name) → `raidr_app` — the catalog app stack.
- `raidr_api` — hosts the catalog and the MCP endpoint.
- `raidr_web` — landing page.
- Releases run from `raidr_app/scripts/push_all.sh`, which processes this repo
  after `raidr_processor` (dependency order). There is no release script here.

## Tech stack

- Vite + `@crxjs/vite-plugin`, React 18, TypeScript, Bun (never npm/yarn/pnpm)
- `@sudobility/components` + `@sudobility/design` for all panel UI
- Tailwind driven by `createTailwindPreset()` from `@sudobility/design`
- `@sudobility/raidr_processor` for the bundle format, redaction, and coverage
- `@sudobility/raidr_types` for `extractCredential` and the raidr.app bridge protocol
- `fflate` for zipping; `fake-indexeddb` for tests

## Structure

```
src/
  manifest.json     MV3 manifest; crxjs builds from it (vite.config.ts adds dev CSP)
  background/       service worker: CDP session, request assembly, source maps
    index.ts          top-level listeners, start/stop/resume, download
    cdpSession.ts     one attached tab: domains, bodies, navigations, probes
    requestAssembler.ts  joins CDP Network events per request id; http(s) only
    sourceMaps.ts     candidate map URLs, "is this map useful"
    tokenBridge.ts    top-level listeners wiring TokenCapture to chrome.* (imported by index.ts)
    tokenCapture.ts   TokenCapture: sign-in popup → verified site token for raidr.app
  bridge/           raidr.app ⇄ extension
    content.ts        content script on raidr.app/localhost: relays window messages, answers ping
    origins.ts        BRIDGE_MATCHES, isBridgeOrigin, BridgeForward/BridgeReply
  offscreen/        capture buffer, IndexedDB store, export
    index.ts          message handler, throttled panel broadcast, export/zip
    sessionState.ts   per-session accumulator → coverage + BundleInput
    capturePipeline.ts  redaction boundary: redact, then hash+store bodies
    store.ts, hash.ts   content-addressed IndexedDB store (SHA-256 keys)
    viteManifest.ts   Vite lazy-chunk list from captured script bodies
    routeMatch.ts     `/users/:id` vs `/users/42`
    sameDomain.ts     registrable-domain filter applied at export
  sidepanel/        React UI (design-system components only)
    index.css         every design token the preset consumes (light + .dark)
  adapters/         thin interface over chrome.* for testability
  introspect/       page probes, serialized into the page via Runtime.evaluate
  shared/messages.ts  RaidrMessage union + isRaidrMessage guard
tests/              bun:test, mirrors src/; tests/support/FakeChromeAdapter.ts
```

## Commands

All verified on 2026-09-30.

| Command | What it does | Status |
| --- | --- | --- |
| `bun install` | install deps | — |
| `bun run dev` | vite + crxjs, HMR on 7178 (strictPort), writes `dist/` | starts |
| `bun run build` | `tsc && vite build` → `dist/` (load unpacked) | passes |
| `bun run typecheck` | `tsc --noEmit` over `src` and `tests` | passes |
| `bun test` (or `bun run test:unit`) | 148 tests in 14 files, no browser needed | passes |

There is no lint or format script. There is no `test` script in
`package.json`; `bun test` is Bun's built-in runner.

## Capture pipeline

1. **Side panel** (`SidePanel.tsx`) sends `session/start` with the active tab id.
2. **Service worker** (`background/index.ts`) refuses non-http(s) tabs, ensures
   the offscreen document exists, delivers `session/begin` (retried — see
   `deliver`), then `CdpSession.start` attaches `chrome.debugger` and enables
   Network/Page/Debugger/Runtime. Tab id + navigation counter go to
   `chrome.storage.session`.
3. CDP events reach the worker's **top-level** `adapter.onEvent` listener →
   `CdpSession.handleEvent`. `RequestAssembler` joins request/response/finish;
   the session fetches the body (`Network.getResponseBody`, or a `body-evicted`
   gap), tries source maps on `Debugger.scriptParsed`, and on each
   `Page.loadEventFired` / `Page.navigatedWithinDocument` records a navigation
   (DOM snapshot for same-document ones) and re-runs the probes.
4. The worker's `CaptureSink` forwards each result as a `capture/*` message.
5. **Offscreen** (`offscreen/index.ts`) passes them to `SessionState`;
   `CapturePipeline` **redacts before storing** (bodies go to IndexedDB by
   SHA-256). Stats, coverage and redaction are broadcast to the panel at most
   every 250 ms.
6. **Export**: panel sends `export/start` (enabled only after the redaction
   checkbox) → offscreen builds `buildBundleFiles(state.bundleInput())`
   (filtered to the site's registrable domain), zips, makes a blob URL, sends
   `export/ready` → worker calls `chrome.downloads.download({ saveAs: true })`.

## Site token capture (raidr.app bridge)

raidr.app's API playground asks the extension for a site's token so the user
never copies it out of DevTools. Protocol types (`BridgeRequest`,
`BridgeResponse`, `TokenRequest`, `CapturedCredential`) come from
`@sudobility/raidr_types`.

1. **Content script** (`bridge/content.ts`, `document_start`) runs on the
   pages in `BRIDGE_MATCHES` (`https://raidr.app/*`, `https://*.raidr.app/*`,
   `http://localhost/*`, `http://127.0.0.1/*`). It accepts only same-window,
   same-origin messages that pass `isBridgeRequest`, answers `ping` itself
   with `pong` + the manifest version, and forwards `token/request` /
   `token/cancel` to the worker as `bridge/forward`. If the forward fails, a
   `token/request` gets `token/failed` (`error`).
2. **Worker** (`background/tokenBridge.ts`) drops a forward unless the sender
   is this extension and the sender tab's URL passes `isBridgeOrigin`, then
   calls `TokenCapture.start`; it sends `token/opened` once the window is up.
3. **`TokenCapture`** opens `loginUrl` in a 520×760 popup window in the user's
   own profile (an existing session is picked up at once). A window that
   cannot be opened fails with `blocked`. One sign-in per raidr tab: a new
   request replaces the old one.
4. `webRequest.onBeforeSendHeaders` (`requestHeaders`, `extraHeaders`, types
   xhr/other) reads only requests from that window's tabs to the requested
   `apiHost`, via `extractCredential`. `onCompleted` accepts the token once a
   request carrying it to a path in `userPaths` (matched with
   `matchesPathTemplate`) answers 2xx; with no `userPaths` any 2xx counts.
   Then the window closes and `token/result` (`verified: true`) goes to the
   requesting tab only.
5. **Window closed first** → `token/failed` `closed`, so a guest token is never
   taken. Only when `userPaths` is empty does it return the last token seen,
   `verified: false`. Closing the raidr tab, or `token/cancel`, drops the
   watch and closes the window without a reply.

Watches live in `chrome.storage.session` (`raidr:token-watches`) so a recycled
worker carries on.

## Hard-won constraints

- **Register chrome.* listeners at the top level of the service worker.** MV3
  restores only listeners registered while the worker script is first evaluated.
  Subscribing from inside a message handler means capture dies silently the
  moment the worker is recycled (~30s idle). Session state lives in
  `chrome.storage.session` so a restarted worker resumes.
- **Only http(s) is captured.** A tab carries other extensions' requests too;
  they were ending up in shared bundles.
- **Define every design token the preset consumes** (see `src/sidepanel/index.css`).
  A token the preset maps but the app omits resolves to a *transparent* colour —
  the component lays out correctly and is simply invisible.
  `tests/messages.test.ts` checks the token list.
- **Cards need an explicit border in light mode**: `--card` and `--background`
  are both white, so a borderless Card is invisible.
- **Panel UI uses `@sudobility/components`** (source: `~/projects/mail_box_components`).
  `ProgressBar` exists in that package but is not re-exported from its root
  index; use `Progress`.
- Probes are serialized with `.toString()` and evaluated in the page, so they
  must reference nothing outside their own body. `tests/introspect` enforces it.
- **`src/introspect/probes.ts` must stay byte-identical** with
  `raidr_cli/src/introspect/probes.ts` and `raidr_crawler/src/introspect/probes.ts`.
  The parity tests live in those repos
  (`tests/introspect/probesParity.test.ts`) and read this file from the
  sibling checkout; they gate releases via `push_all.sh`, and are skipped in
  single-repo CI. Any edit here — including comments and whitespace — must be
  copied verbatim to both. The file cannot move into `raidr_processor`, whose
  tsconfig forbids DOM types.
- **Redact before storing.** `CapturePipeline.ingest` is the only writer of
  request/response bodies to the content store, and it redacts first. The
  per-session salt (`offscreen/index.ts`) is never persisted or exported.
- **`SessionState.begin` must reset every accumulating field.** The offscreen
  document (and so the `SessionState`) outlives a capture; a field added to the
  class but not reset in `begin` leaks one site's data into the next bundle.
- **`BRIDGE_MATCHES` must equal `manifest.content_scripts[0].matches`**
  (`tests/bridge/origins.test.ts` checks). The raidr.app origins the extension
  serves are listed only there; a new raidr_app deploy domain must be added to
  both and to `isBridgeOrigin`, or the app sees no extension.
- **The token bridge never answers a page outside `isBridgeOrigin`**, and
  `TokenCapture` reads only its own popup window's requests to the one API
  host asked for. Keep both checks when changing either file.
- **Every message kind must be in `KINDS`** (`shared/messages.ts`) as well as in
  the `RaidrMessage` union, or `isRaidrMessage` drops it everywhere.

## Testing

`bun test` runs everything under `tests/` with no browser: chrome.debugger is
replaced by `tests/support/FakeChromeAdapter.ts`, IndexedDB by
`fake-indexeddb/auto`, and probe sources are evaluated with `new Function`.
`background/index.ts`, `offscreen/index.ts` and the React panel have no unit
tests — they are chrome.* wiring; verify them by loading `dist/` unpacked and
capturing a real page.

## Making common changes

- **New message kind**: add to the `RaidrMessage` union and `KINDS` in
  `shared/messages.ts` → the list in `tests/messages.test.ts` → sender →
  receiver(s) (`background/index.ts`, `offscreen/index.ts`, `SidePanel.tsx`).
- **New CDP event to capture**: `CdpSession.handle` (and `start` if it needs a
  domain enabled) → a `CaptureSink` method → `buildSink` in
  `background/index.ts` → a `capture/*` message → `SessionState` ingest method
  (reset in `begin`) → `bundleInput` → tests in `tests/background` and
  `tests/offscreen`.
- **New probe**: `introspect/probes.ts` + `PROBE_SOURCES`, then copy the file
  byte-for-byte to `raidr_cli` and `raidr_crawler`, then use it from
  `CdpSession`.
- **Redaction rule**: change `raidr_processor`, not this repo; bump the
  dependency here.
- **New raidr.app origin for the bridge**: `BRIDGE_MATCHES` and
  `isBridgeOrigin` in `bridge/origins.ts` → `content_scripts[0].matches` in
  `src/manifest.json`.
- **New panel token or component**: define any new token in both `:root` and
  `.dark` in `sidepanel/index.css` and in the token test.

## Gotchas

- `src/manifest.json` `version` (0.0.1) is not kept in sync with
  `package.json`; the built extension reports the manifest's value.
- The bridge messages (`bridge/forward`, `bridge/reply`) are not
  `RaidrMessage` kinds and are not in `KINDS`; `tokenBridge.ts` and
  `content.ts` check `kind` themselves.
- The `webRequest` permission is used only by the token bridge. Capture still
  goes through CDP.
- `capture/body` and `export/manifest` are declared message kinds that nothing
  currently sends.
- `chrome.runtime.sendMessage` broadcasts: `session/stopped` and
  `session/detached` reach both the panel and the offscreen document (which
  stamps `endedAt`). `export/start` also reaches the worker, which ignores it.
- The DOM snapshot is taken only for same-document (client-side) navigations;
  full loads keep their served document instead.
- Export drops requests from other registrable domains (e.g. an asset CDN) on
  purpose; the panel's counts still include them.
- `bun run dev` writes a dev build into `dist/`; run `bun run build` before
  loading `dist/` for a real test.

## Related projects

- `raidr_processor` — bundle format, redaction, coverage, analysis
- `raidr_cli` — reconstruction CLI and the agent skill
- `raidr_crawler` — headless capture; holds a copy of `probes.ts`
- `raidr_web` — landing page
- `testomniac_extension` — reference for the design-system setup
