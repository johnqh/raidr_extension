# xray_extension

A Chrome MV3 extension that captures a running web app — its network traffic,
its JavaScript, its source maps, its rendered DOM — and exports it as an
**xray bundle** for reconstruction.

## Install

Not yet on the Chrome Web Store. Load it unpacked:

```bash
bun install
bun run build     # → dist/
```

Then open `chrome://extensions`, enable Developer mode, and **Load unpacked**
pointing at `dist/`. Open the side panel on the tab you want to capture.

## What it captures

- **Network, via the DevTools Protocol.** A CDP session attached to the tab
  records requests and responses with their bodies — including the ones
  `webRequest` cannot see. Only `http(s)` is captured; a tab carries other
  extensions' traffic too, and it was ending up in shared bundles.
- **Chunks and source maps.** Every served script, plus the source map when the
  site shipped one, so reconstruction can start from real source rather than
  minified output.
- **Rendered DOM snapshots**, so server-rendered sites reconstruct correctly
  rather than as an empty SPA shell.
- **A coverage meter.** The side panel shows which routes and endpoints have
  been exercised, so you know what the capture is still missing before you
  export — gaps are recorded explicitly in the bundle rather than left implicit.

## Redaction happens before anything is written

Bearer tokens, cookies, auth headers, and values that look like credentials or
PII are redacted on the way into the buffer, not on the way out. Identifiers are
replaced with stable pseudonyms so a user id stays joinable across requests
without being the real one. The side panel reports exactly what was redacted.

The rules live in [`xray_lib`](https://github.com/johnqh/xray_lib), which the
extension imports — the same code path the CLI uses, so a bundle is redacted
identically no matter who produced it.

## Structure

```
src/
  background/       service worker: CDP session, request assembly, source maps
  offscreen/        capture buffer, IndexedDB store, export
  sidepanel/        React UI
  adapters/         thin interface over chrome.* for testability
  introspect/       page probes, serialized into the page via Runtime.evaluate
```

## Development

```bash
bun run dev        # vite, HMR on 7176
bun run typecheck
bun test           # no browser needed
```

## The xray project

| Repository | Role |
|---|---|
| [`xray_lib`](https://github.com/johnqh/xray_lib) | Bundle format and pure analysis |
| [`xray_extension`](https://github.com/johnqh/xray_extension) | Chrome MV3 extension that performs the capture — this repo |
| [`xray_cli`](https://github.com/johnqh/xray_cli) | Reconstruction CLI and the agent skill |
| [`xray_web`](https://github.com/johnqh/xray_web) | Landing site |

## License

BUSL-1.1 — see [LICENSE.md](LICENSE.md).
