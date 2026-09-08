# Chunk backfill

Fetching the chunks a capture discovered but never obtained bytes for, so the
bundle holds the application rather than only the path the operator walked.

## The problem

A chunk is "known" when something told us it exists — a script reference in the
document, or an entry in a Vite dep list parsed out of a captured script. It is
"captured" when some captured request URL matches it. The two diverge for two
unrelated reasons, and the operator cannot tell them apart:

- The script loaded **before capture started**. The page has it, the bundle does
  not. This is the common case, because the operator opens the app and then
  opens the panel.
- The script is a **lazy route chunk** the session never triggered.

Either way reconstruction is missing source it knows the name of. Nothing in the
tool closes that gap today, and the operator's only recourse is to guess which
part of the app to click next.

Cross-origin fetching from the extension was impossible until the `connect-src`
fix landed on 2026-09-08; that is what makes this feature available at all.

## Goals

- Obtain bytes for any known chunk the capture lacks, whichever reason it lacks
  them for.
- Never let a fetched byte be mistaken for traffic the page produced.
- Never generate enough traffic to disturb the site the operator is using.
- Fail loudly rather than silently.

## Non-goals

- `raidr_cli/src/capture/harness.ts` runs its own capture with the same gap. It
  is deliberately untouched here.
- Discovering chunks nobody referenced. Backfill fetches what is already known;
  it does not crawl.
- Non-script resources. Images, fonts and stylesheets are out of scope.

## Decisions

Settled before design, and recorded here so the implementation does not
relitigate them:

| Question | Decision |
|---|---|
| Which gap to close | Both, treated identically |
| Bundle representation | A normal request in `requests[]`, carrying a flag |
| When to fetch | Continuously during capture |
| How aggressively | Conservative: 2 concurrent, capped |

## Architecture

### Where it lives

The **offscreen document**. It already owns `knownChunks`, `loadedChunks`, the
content store and the capture pipeline, and as an extension page it inherits
both the widened `connect-src` and `<all_urls>` host permissions.

The service worker is the wrong home: MV3 recycles it after roughly 30 seconds
of inactivity, which is precisely when a deliberately slow queue would be
mid-drain. The offscreen document exists to hold exactly this kind of state.

### Chunk identity gains a URL

This is the substantive change and everything else depends on it.

A chunk is currently a bare path — `assets/App-xorPPbGf.js` — because
`readChunkManifest` strips scheme and host, and Vite dep lists are
build-relative. A path cannot be fetched, and for an app whose chunks sit on a
CDN the origin is not recoverable from the manifest origin either: reddit serves
`reddit.com` from `redditstatic.com`.

Resolution at each of the two discovery points:

- **`readChunkManifest`** resolves every reference against the document:
  `new URL(src, location.href).href`. The probe already has the full `src`; it
  currently throws the origin away.
- **`viteChunksFromSource`** yields build-relative paths that resolve against
  the URL of the script that carried the dep list. `SessionState.ingestRequest`
  has that URL in hand when it parses the body, so resolution happens at the
  call site rather than inside the parser, which stays pure.

`knownChunks` becomes a `Set<string>` of absolute URLs. `loadedChunks` compares
those URLs to captured request URLs, replacing the `endsWith` suffix test that
the path representation forced.

Only `http:` and `https:` URLs are kept, consistent with the existing rule that
only http(s) is captured.

#### Matching

Exact string equality is too strict: the same chunk is routinely requested with
a cache-busting query, and a host differing only in case or an explicit default
port would read as a different chunk. Both sides are therefore normalised to
**lowercased host plus pathname**, dropping scheme, port, query and fragment,
and compared on that. Dropping the scheme keeps an http-vs-https difference from
splitting one chunk into two.

The stored URL keeps its query, because it is what gets fetched; only the
comparison key drops it. Normalisation is a single exported function so the
queue and the loaded test cannot disagree about what counts as the same chunk.

### The queue

A new `src/offscreen/backfillQueue.ts`, taking a fetch function and a sink so it
is testable without a network.

- Enqueue on discovery: whenever `ingestRuntime` or `ingestRequest` adds a chunk
  URL that has no captured body.
- **2 concurrent** fetches, with a **250 ms** delay between starts.
- Each URL is **attempted exactly once**, tracked in an `attempted` set that
  includes failures. A retry policy is not worth the traffic.
- **8 MB** per response, **64 MB** per session. A response exceeding the per-
  response cap is discarded rather than truncated — a half a chunk is not a
  chunk. Reaching the session cap stops the queue and records one gap.
- `credentials: 'include'`, so an authenticated CDN serves the operator's own
  bytes.
- Dequeue without fetching if the chunk was captured normally while queued,
  which happens whenever the operator navigates somewhere that loads it.

### Provenance

`CapturedRequest` gains `backfilled?: boolean` in raidr_lib. The synthesized
record is otherwise ordinary:

| Field | Value |
|---|---|
| `id` | `bf1`, `bf2`, … — a counter, distinct from CDP request ids |
| `method` | `GET` |
| `url` | the chunk URL |
| `resourceType` | `Script` |
| `status`, `responseHeaders`, `mimeType` | from the response |
| `requestHeaders` | `{}` — we did not observe a request |
| `navigationId` | `null` — it belongs to no navigation |
| `fromCache` | `false` |
| `backfilled` | `true` |

It goes through `CapturePipeline.ingest` like any other response, so redaction
applies unchanged — and `isImmutableAsset` already leaves JavaScript untouched.

`unpackChunks` in raidr_cli reconstructs from any JavaScript response body in
`requests[]` and never reads `runtime/chunks.json`, so backfilled chunks reach
reconstruction with no CLI change. The flag exists for provenance, not
behaviour.

### Failure handling

A failed backfill records a `Gap` with reason `backfill-failed`, carrying the
URL and the error text.

This is not incidental. Source-map capture was broken for the entire life of the
project because `discoverSourceMap` could not distinguish a blocked fetch from
an absent map, and its comment asserted the benign reading. A backfill that
quietly fetches nothing would be the same bug in a new place.

### Bundle format impact

`runtime/chunks.json` entries become absolute URLs rather than build-relative
paths. Safe: `raidr_cli/src/bundle/load.ts:102` reads that file as metadata and
reconstruction goes through `requests[]`.

Bundles written by earlier versions keep paths. Nothing reads the field in a way
that breaks on the difference.

## UI

The coverage card shows a count, not a ratio — a denominator would have to be
every chunk the app has, which nothing can know. Backfilled chunks are counted,
with the split stated rather than hidden:

```
Chunks captured        37 (4 fetched)
    2 referenced but not captured
```

The parenthetical appears only when something was backfilled. This follows the
same principle as removing the Complete/Incomplete badge: the panel says what it
knows and does not imply more.

## Testing

**URL resolution** — a relative dep against its declaring script's URL; an
absolute `src` left intact; a CDN origin differing from the document origin; a
non-http scheme rejected.

**Queue**, against a fake fetch — no more than 2 in flight; a URL attempted once
even after failure; a response over the per-response cap discarded; the session
cap halting the queue; a chunk captured normally while queued never fetched.

**SessionState** — a backfilled body makes a chunk count as captured; the
synthesized record carries `backfilled: true`; a failed backfill produces a gap
with reason `backfill-failed`.

**End-to-end**, by the pattern already used this session: drive real Chrome over
CDP against a live Vite app, confirm the captured chunk count rises toward the
dep-list total without the page requesting anything extra.

## Files

**raidr_extension**
- `src/introspect/probes.ts` — resolve references to absolute URLs (mirror to
  raidr_cli; the parity test requires byte-identical copies)
- `src/offscreen/viteManifest.ts` — unchanged parser; callers resolve
- `src/offscreen/sessionState.ts` — URL-keyed chunks, exact-match loaded test,
  enqueue on discovery, ingest backfilled responses
- `src/offscreen/backfillQueue.ts` — new
- `src/offscreen/index.ts` — wire the queue to the session

**raidr_lib**
- `src/bundle/types.ts` — `backfilled?: boolean` on `CapturedRequest`; the
  `backfill-failed` gap reason

**raidr_cli**
- `src/introspect/probes.ts` — mirror only

## Risks

**Fetching from a site the operator is using.** Mitigated by the caps, but the
tool is now generating traffic under the operator's cookies. The conservative
limits are a floor, not a detail to tune away.

**A chunk URL that 404s.** Common for hashed filenames recovered from a stale
dep list. Each produces a gap; a noisy capture could produce many. If that
proves annoying in practice, the fix is to report them as one aggregated gap
rather than to stop recording them.

**Authenticated CDNs returning personalised bytes.** `credentials: 'include'` is
required for chunks behind auth, but it means a backfilled body could differ
from what an anonymous visitor receives. The `backfilled` flag is what lets a
reader notice this.
