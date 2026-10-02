import { describe, expect, test } from 'bun:test';
import type { TokenRequest } from '@sudobility/raidr_types';
import { type CaptureOutcome, headerRecord, TokenCapture, type Watch } from '@/background/tokenCapture';

const REQUEST: TokenRequest = {
  apiHost: 'studio-api.example.com',
  loginUrl: 'https://example.com/sign-in',
  auth: { style: 'bearer' },
  userPaths: ['/api/me', '/api/clip/{clip_id}'],
};

function harness(opts: { block?: boolean } = {}) {
  const replies: Array<{ tab: number; id: string; outcome: CaptureOutcome }> = [];
  const closed: number[] = [];
  let saved: Watch[] = [];
  let nextWindow = 100;
  const tabWindow = new Map<number, number>([[7, 100], [8, 999]]);
  const capture = new TokenCapture({
    openWindow: async () => (opts.block ? null : { windowId: nextWindow++, tabId: 7 }),
    closeWindow: async (id) => void closed.push(id),
    windowOfTab: async (tab) => tabWindow.get(tab) ?? null,
    reply: (tab, id, outcome) => void replies.push({ tab, id, outcome }),
    load: async () => saved,
    save: async (w) => void (saved = structuredClone(w)),
  });
  return { capture, replies, closed, saved: () => saved };
}

const bearer = (token: string) => [{ name: 'Authorization', value: `Bearer ${token}` }];
const api = (path: string) => `https://studio-api.example.com${path}`;

describe('TokenCapture', () => {
  test('a 2xx from a signed-in-only endpoint delivers the token and closes the window', async () => {
    const h = harness();
    expect(await h.capture.start('r1', 42, REQUEST)).toBe(true);
    await h.capture.onRequest({ requestId: 'a', tabId: 7, url: api('/api/feed'), requestHeaders: bearer('anon') });
    await h.capture.onResponse({ requestId: 'a', tabId: 7, url: api('/api/feed'), statusCode: 200 });
    expect(h.replies).toHaveLength(0); // not a signed-in-only path
    await h.capture.onRequest({ requestId: 'b', tabId: 7, url: api('/api/me'), requestHeaders: bearer('tok') });
    await h.capture.onResponse({ requestId: 'b', tabId: 7, url: api('/api/me'), statusCode: 200 });
    expect(h.replies).toEqual([{ tab: 42, id: 'r1', outcome: { kind: 'result', credential: { token: 'tok', verified: true } } }]);
    expect(h.closed).toEqual([100]);
    expect(h.capture.idle()).toBe(true);
  });

  test('a 401 is not enough; requests from other windows and hosts are ignored', async () => {
    const h = harness();
    await h.capture.start('r1', 42, REQUEST);
    await h.capture.onRequest({ requestId: 'a', tabId: 7, url: api('/api/me'), requestHeaders: bearer('stale') });
    await h.capture.onResponse({ requestId: 'a', tabId: 7, url: api('/api/me'), statusCode: 401 });
    await h.capture.onRequest({ requestId: 'b', tabId: 8, url: api('/api/me'), requestHeaders: bearer('other-window') });
    await h.capture.onResponse({ requestId: 'b', tabId: 8, url: api('/api/me'), statusCode: 200 });
    await h.capture.onRequest({ requestId: 'c', tabId: 7, url: 'https://elsewhere.example.com/api/me', requestHeaders: bearer('x') });
    await h.capture.onResponse({ requestId: 'c', tabId: 7, url: 'https://elsewhere.example.com/api/me', statusCode: 200 });
    expect(h.replies).toHaveLength(0);
    expect(h.saved()[0]?.last).toBe('stale');
  });

  test('closing the window fails, even after a guest token was seen', async () => {
    const h = harness();
    await h.capture.start('r1', 42, REQUEST);
    await h.capture.onRequest({ requestId: 'a', tabId: 7, url: api('/api/feed'), requestHeaders: bearer('guest') });
    await h.capture.onWindowClosed(100);
    expect(h.replies[0]?.outcome).toEqual({ kind: 'failed', reason: 'closed' });
    expect(h.closed).toEqual([]);
  });

  test('with no signed-in-only endpoints known, any 2xx verifies; closing returns the last token unverified', async () => {
    const h = harness();
    await h.capture.start('r1', 42, { ...REQUEST, userPaths: [] });
    await h.capture.onRequest({ requestId: 'a', tabId: 7, url: api('/x'), requestHeaders: bearer('seen') });
    await h.capture.onResponse({ requestId: 'a', tabId: 7, url: api('/x'), statusCode: 500 });
    await h.capture.onWindowClosed(100);
    expect(h.replies[0]?.outcome).toEqual({ kind: 'result', credential: { token: 'seen', verified: false } });
  });

  test('a blocked window fails at once; a closed raidr tab ends the watch silently', async () => {
    const blocked = harness({ block: true });
    expect(await blocked.capture.start('r1', 42, REQUEST)).toBe(false);
    expect(blocked.replies[0]?.outcome).toEqual({ kind: 'failed', reason: 'blocked' });

    const h = harness();
    await h.capture.start('r1', 42, REQUEST);
    await h.capture.onSenderClosed(42);
    expect(h.replies).toHaveLength(0);
    expect(h.closed).toEqual([100]);
  });

  test('state survives a worker restart', async () => {
    const h = harness();
    await h.capture.start('r1', 42, REQUEST);
    const saved = h.saved();
    const replies: CaptureOutcome[] = [];
    const revived = new TokenCapture({
      openWindow: async () => null,
      closeWindow: async () => undefined,
      windowOfTab: async () => 100,
      reply: (_t, _i, o) => void replies.push(o),
      load: async () => saved,
      save: async () => undefined,
    });
    await revived.onRequest({ requestId: 'z', tabId: 7, url: api('/api/clip/9'), requestHeaders: bearer('t2') });
    await revived.onResponse({ requestId: 'z', tabId: 7, url: api('/api/clip/9'), statusCode: 204 });
    expect(replies).toEqual([{ kind: 'result', credential: { token: 't2', verified: true } }]);
  });

  test('headerRecord lower-cases names and joins repeats', () => {
    expect(headerRecord([{ name: 'Cookie', value: 'a=1' }, { name: 'cookie', value: 'b=2' }, { name: 'X' }])).toEqual({ cookie: 'a=1; b=2' });
  });
});
