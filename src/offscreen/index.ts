import { isXrayMessage } from '@/shared/messages';
import { IdbContentStore } from './store';
import { SessionState } from './sessionState';
import { buildBundleFiles, zipBundle, bundleFilename } from '@sudobility/xray_lib';

const store = new IdbContentStore('xray-capture', indexedDB);

// The salt is generated per session and deliberately never persisted or
// exported: it is what keeps short pseudonym hashes from being brute-forced
// back to the original credentials.
const salt = crypto.randomUUID();
const state = new SessionState(store, salt);

/**
 * Coalesces panel updates.
 *
 * This used to fire two messages per captured request, each recomputing the
 * whole coverage report — which is O(routes x requests), so a 300-request
 * capture did it 600 times and the cost grew quadratically. The panel is a
 * progress display; four updates a second is more than enough, and the final
 * state is always flushed.
 */
const BROADCAST_INTERVAL_MS = 250;
let broadcastTimer: ReturnType<typeof setTimeout> | null = null;

function send(): void {
  void state.storageStats().then((stats) => {
    const manifest = state.manifest();
    void chrome.runtime
      .sendMessage({
        kind: 'session/stats',
        stats: {
          requests: manifest?.counts.requests ?? 0,
          bodies: manifest?.counts.bodies ?? 0,
          gaps: manifest?.counts.gaps ?? 0,
          bytes: stats.bytes,
          quotaPct: stats.quotaPct,
        },
      })
      .catch(() => undefined);
  });

  // The side panel may be closed; a message with no receiver is not an error.
  void chrome.runtime
    .sendMessage({ kind: 'session/coverage', report: state.coverage() })
    .catch(() => undefined);
  void chrome.runtime
    .sendMessage({ kind: 'session/redaction', entries: state.redaction() })
    .catch(() => undefined);
}

function broadcast(): void {
  if (broadcastTimer !== null) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    send();
  }, BROADCAST_INTERVAL_MS);
}

/** Flushes immediately, for moments the operator is waiting on: stop, export. */
function broadcastNow(): void {
  if (broadcastTimer !== null) {
    clearTimeout(broadcastTimer);
    broadcastTimer = null;
  }
  send();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isXrayMessage(message)) return;

  switch (message.kind) {
    case 'session/begin':
      state.begin(message.origin, new Date().toISOString(), crypto.randomUUID());
      broadcast();
      return;

    case 'capture/request': {
      const { assembled, body } = message.row as {
        assembled: Parameters<SessionState['ingestRequest']>[0];
        body: string | null;
      };
      void state.ingestRequest(assembled, body).then(broadcast);
      return;
    }

    case 'capture/gap':
      state.ingestGap(message.gap);
      broadcast();
      return;

    case 'capture/sourcemap':
      void state.ingestSourceMap(message.scriptUrl, message.text).then(broadcast);
      return;

    case 'session/stopped': {
      const manifest = state.manifest();
      if (manifest && !manifest.endedAt) manifest.endedAt = new Date().toISOString();
      broadcastNow();
      return;
    }

    case 'session/detached': {
      const detached = state.manifest();
      if (detached && !detached.endedAt) detached.endedAt = new Date().toISOString();
      broadcastNow();
      return;
    }

    case 'capture/navigation':
      void state.ingestNavigation(message.navigation).then(broadcast);
      return;

    case 'capture/runtime':
      state.ingestRuntime(message.snapshot);
      broadcast();
      return;

    case 'export/start':
      void (async () => {
        const manifest = state.manifest();
        if (!manifest) {
          sendResponse({ ok: false, error: 'no active session' });
          return;
        }
        manifest.endedAt = new Date().toISOString();
        const files = await buildBundleFiles(state.bundleInput());
        const zipped = await zipBundle(files);
        // Re-wrap for the same ArrayBufferLike/BufferSource reason as sha256Hex.
        const blobUrl = URL.createObjectURL(
          new Blob([new Uint8Array(zipped)], { type: 'application/zip' })
        );
        void chrome.runtime.sendMessage({
          kind: 'export/ready',
          blobUrl,
          filename: bundleFilename(manifest.origin, manifest.startedAt),
        });
        // The download reads the blob synchronously from the same origin; hold
        // it briefly, then release. An export can be hundreds of megabytes and
        // the offscreen document outlives every one of them.
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
        broadcastNow();
        sendResponse({ ok: true });
      })();
      return true; // keep the message channel open for the async response

    default:
      return;
  }
});
