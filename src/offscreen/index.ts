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

function broadcast(): void {
  void chrome.runtime.sendMessage({
    kind: 'session/coverage',
    report: state.coverage(),
  });
  void chrome.runtime.sendMessage({
    kind: 'session/redaction',
    entries: state.redaction(),
  });
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
        sendResponse({ ok: true });
      })();
      return true; // keep the message channel open for the async response

    default:
      return;
  }
});
