/**
 * Content script on raidr.app: relays the page's token requests to the
 * worker and the answers back. The page and the extension share no other
 * channel; only same-window messages with the raidr-app source get through.
 */
import {
  type BridgeResponse,
  isBridgeRequest,
  RAIDR_BRIDGE_EXTENSION,
} from '@sudobility/raidr_types';
import type { BridgeForward, BridgeReply } from './origins';

function answer(response: BridgeResponse): void {
  window.postMessage(response, window.location.origin);
}

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const request = event.data as unknown;
  if (!isBridgeRequest(request)) return;
  if (request.type === 'ping') {
    answer({
      source: RAIDR_BRIDGE_EXTENSION,
      type: 'pong',
      id: request.id,
      version: chrome.runtime.getManifest().version,
    });
    return;
  }
  const forward: BridgeForward = { kind: 'bridge/forward', request };
  void chrome.runtime.sendMessage(forward).catch((error: unknown) => {
    if (request.type !== 'token/request') return;
    answer({
      source: RAIDR_BRIDGE_EXTENSION,
      type: 'token/failed',
      id: request.id,
      reason: 'error',
      message: String(error),
    });
  });
});

chrome.runtime.onMessage.addListener((message: unknown) => {
  const reply = message as Partial<BridgeReply> | null;
  if (reply?.kind === 'bridge/reply' && reply.response) answer(reply.response);
});
