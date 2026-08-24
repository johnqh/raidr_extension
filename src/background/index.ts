import { isXrayMessage } from '@/shared/messages';

const OFFSCREEN_PATH = 'src/offscreen/index.html';

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

chrome.runtime.onMessage.addListener((message) => {
  if (!isXrayMessage(message)) return;

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
