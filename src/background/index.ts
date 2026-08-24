import { isXrayMessage } from '@/shared/messages';
import { LiveChromeAdapter } from '@/adapters/ChromeAdapter';
import { CdpSession } from './cdpSession';

const OFFSCREEN_PATH = 'src/offscreen/index.html';

let session: CdpSession | null = null;

async function ensureOffscreen(): Promise<void> {
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  if (existing.length > 0) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [chrome.offscreen.Reason.BLOBS],
    justification:
      'Holds the capture buffer and builds the export archive; a service worker cannot, because it is terminated when idle.',
  });
}

async function startSession(tabId: number): Promise<void> {
  await ensureOffscreen();
  session = new CdpSession(new LiveChromeAdapter(), {
    onRequest: async (assembled, body) => {
      await chrome.runtime.sendMessage({
        kind: 'capture/request',
        row: { assembled, body },
      });
    },
    onGap: async (gap) => {
      await chrome.runtime.sendMessage({ kind: 'capture/gap', gap });
    },
    onRuntime: async (snapshot) => {
      await chrome.runtime.sendMessage({ kind: 'capture/runtime', snapshot });
    },
  });
  await session.start(tabId);
}

chrome.runtime.onMessage.addListener((message) => {
  if (!isXrayMessage(message)) return;

  if (message.kind === 'session/start') void startSession(message.tabId);
  if (message.kind === 'session/stop') void session?.stop();

  if (message.kind === 'export/ready') {
    void chrome.downloads.download({
      url: message.blobUrl,
      filename: message.filename,
      saveAs: true,
    });
  }
});

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error: unknown) => console.error('[xray] side panel', error));

void ensureOffscreen();
