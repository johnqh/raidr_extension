import { isXrayMessage } from '@/shared/messages';

chrome.runtime.onMessage.addListener((message) => {
  if (!isXrayMessage(message)) return;
  console.debug('[xray] message', message.kind);
});

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error: unknown) => console.error('[xray] side panel', error));
