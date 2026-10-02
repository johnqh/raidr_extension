/**
 * Wires `TokenCapture` to Chrome: the bridge messages from raidr.app's
 * content script, the sign-in popup window, and the request/response events
 * of its tabs. Imported for its side effects by `background/index.ts`, so the
 * listeners are registered at the worker's top level and survive a restart.
 */
import { RAIDR_BRIDGE_EXTENSION, type BridgeResponse } from '@sudobility/raidr_types';
import { type BridgeForward, type BridgeReply, isBridgeOrigin } from '@/bridge/origins';
import { type CaptureOutcome, TokenCapture, type Watch } from './tokenCapture';

const STORE_KEY = 'raidr:token-watches';

function toResponse(id: string, outcome: CaptureOutcome): BridgeResponse {
  return outcome.kind === 'result'
    ? { source: RAIDR_BRIDGE_EXTENSION, type: 'token/result', id, credential: outcome.credential }
    : {
        source: RAIDR_BRIDGE_EXTENSION,
        type: 'token/failed',
        id,
        reason: outcome.reason,
        ...(outcome.message ? { message: outcome.message } : {}),
      };
}

function send(tabId: number, response: BridgeResponse): void {
  const reply: BridgeReply = { kind: 'bridge/reply', response };
  void chrome.tabs.sendMessage(tabId, reply).catch(() => undefined);
}

export const tokenCapture = new TokenCapture({
  openWindow: async (url) => {
    const win = await chrome.windows.create({ url, type: 'popup', width: 520, height: 760, focused: true });
    if (win?.id === undefined) return null;
    return { windowId: win.id, tabId: win.tabs?.[0]?.id ?? null };
  },
  closeWindow: async (windowId) => {
    await chrome.windows.remove(windowId);
  },
  windowOfTab: async (tabId) => (await chrome.tabs.get(tabId)).windowId ?? null,
  reply: (senderTabId, id, outcome) => send(senderTabId, toResponse(id, outcome)),
  load: async () =>
    ((await chrome.storage.session.get(STORE_KEY))[STORE_KEY] as Watch[] | undefined) ?? [],
  save: async (watches) => {
    await chrome.storage.session.set({ [STORE_KEY]: watches });
  },
});

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  const forward = message as Partial<BridgeForward> | null;
  if (forward?.kind !== 'bridge/forward' || !forward.request) return;
  // Only raidr.app's own tabs, through this extension's content script.
  const tabId = sender.tab?.id;
  if (sender.id !== chrome.runtime.id || tabId === undefined || !isBridgeOrigin(sender.tab?.url)) return;
  const request = forward.request;
  if (request.type === 'token/request') {
    void tokenCapture.start(request.id, tabId, request.request).then((opened) => {
      if (opened) send(tabId, { source: RAIDR_BRIDGE_EXTENSION, type: 'token/opened', id: request.id });
    });
  } else if (request.type === 'token/cancel') {
    void tokenCapture.cancel(request.id);
  }
});

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (!tokenCapture.idle()) void tokenCapture.onRequest(details);
    return undefined;
  },
  { urls: ['<all_urls>'], types: ['xmlhttprequest', 'other'] },
  ['requestHeaders', 'extraHeaders']
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (tokenCapture.idle()) return;
    void tokenCapture.onResponse(details);
  },
  { urls: ['<all_urls>'], types: ['xmlhttprequest', 'other'] }
);

chrome.windows.onRemoved.addListener((windowId) => {
  void tokenCapture.onWindowClosed(windowId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void tokenCapture.onSenderClosed(tabId);
});
