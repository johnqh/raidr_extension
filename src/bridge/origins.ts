/**
 * Pages allowed to ask the extension for a site token: raidr.app and local
 * development. Must list the same pages as `content_scripts[0].matches` in
 * `src/manifest.json` (tests/bridge/origins.test.ts checks); the worker also
 * re-checks the sender against it, so a content script injected anywhere else
 * still gets no tokens.
 */
export const BRIDGE_MATCHES = [
  'https://raidr.app/*',
  'https://*.raidr.app/*',
  'http://localhost/*',
  'http://127.0.0.1/*',
] as const;

/** True when `url` is a page `BRIDGE_MATCHES` covers (any port on localhost). */
export function isBridgeOrigin(url: string | undefined): boolean {
  if (!url) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === 'https:') return u.hostname === 'raidr.app' || u.hostname.endsWith('.raidr.app');
  if (u.protocol === 'http:') return u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  return false;
}

/** Content script → worker. */
export interface BridgeForward {
  kind: 'bridge/forward';
  request: import('@sudobility/raidr_types').BridgeRequest;
}

/** Worker → content script in the raidr tab. */
export interface BridgeReply {
  kind: 'bridge/reply';
  response: import('@sudobility/raidr_types').BridgeResponse;
}
