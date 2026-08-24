import { isXrayMessage } from '@/shared/messages';
import { IdbContentStore } from './store';
import { buildBundleFiles, zipBundle, bundleFilename } from './exporter';
import type { BundleInput } from './exporter';

const store = new IdbContentStore('xray-capture', indexedDB);

// Session state lives here, not in the service worker: MV3 terminates an idle
// worker after ~30s, which would discard the buffer mid-capture.
const session = {
  manifest: null as BundleInput['manifest'] | null,
  requests: [] as BundleInput['requests'],
  frames: [] as BundleInput['frames'],
  gaps: [] as BundleInput['gaps'],
  redaction: [] as BundleInput['redaction'],
  runtime: {
    framework: null,
    routes: [],
    stores: [],
    chunks: { known: [], loaded: [] },
    coverage: {},
  } as BundleInput['runtime'],
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isXrayMessage(message)) return;

  if (message.kind === 'export/start') {
    void (async () => {
      if (!session.manifest) {
        sendResponse({ ok: false, error: 'no active session' });
        return;
      }
      const files = await buildBundleFiles({ store, ...session, manifest: session.manifest });
      const zipped = await zipBundle(files);
      // Re-wrap for the same ArrayBufferLike/BufferSource reason as sha256Hex.
      const blobUrl = URL.createObjectURL(
        new Blob([new Uint8Array(zipped)], { type: 'application/zip' })
      );
      sendResponse({
        ok: true,
        blobUrl,
        filename: bundleFilename(
          session.manifest.origin,
          session.manifest.startedAt
        ),
      });
    })();
    return true; // keep the message channel open for the async response
  }
});

export { session, store };
