# CLAUDE.md — xray_extension

MV3 Chrome extension that captures a running web app's network traffic and
runtime, and exports it as an xray bundle.

## Tech stack

- Vite + `@crxjs/vite-plugin`, React 18, TypeScript, Bun
- `@sudobility/components` + `@sudobility/design` for all panel UI
- Tailwind driven by `createTailwindPreset()` from `@sudobility/design`
- `@sudobility/xray_lib` for the bundle format, redaction, and coverage

## Structure

```
src/
  background/       service worker: CDP session, request assembly, source maps
  offscreen/        capture buffer, IndexedDB store, export
  sidepanel/        React UI (design-system components only)
  adapters/         thin interface over chrome.* for testability
  introspect/       page probes, serialized into the page via Runtime.evaluate
```

## Commands

```bash
bun run dev        # vite, HMR on 7176
bun run build      # tsc && vite build → dist/ (load unpacked)
bun run typecheck
bun test           # 98 tests, no browser needed
```

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
- **Cards need an explicit border in light mode**: `--card` and `--background`
  are both white, so a borderless Card is invisible.
- **Panel UI uses `@sudobility/components`** (source: `~/projects/mail_box_components`).
  `ProgressBar` exists in that package but is not re-exported from its root
  index; use `Progress`.
- Probes are serialized with `.toString()` and evaluated in the page, so they
  must reference nothing outside their own body. `tests/introspect` enforces it,
  and a parity test keeps them byte-identical to the CLI's copy.

## Related projects

- `xray_lib` — bundle format, redaction, coverage, analysis
- `xray_cli` — reconstruction CLI and the agent skill
- `xray_web` — landing page
- `testomniac_extension` — reference for the design-system setup
