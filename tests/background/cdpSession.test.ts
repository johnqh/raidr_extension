import { expect, test } from 'bun:test';
import { FakeChromeAdapter } from '../support/FakeChromeAdapter';
import { CdpSession, type CaptureSink } from '../../src/background/cdpSession';
import type { Gap } from '@sudobility/xray_lib';

function collectingSink() {
  const requests: Array<{ url: string; body: string | null }> = [];
  const gaps: Gap[] = [];
  const sourceMaps: Array<{ scriptUrl: string; text: string }> = [];
  const sink: CaptureSink = {
    onSourceMap: async (scriptUrl, _mapUrl, text) => {
      sourceMaps.push({ scriptUrl, text });
    },
    onRequest: async (assembled, body) => {
      requests.push({ url: assembled.url, body });
    },
    onGap: async (gap) => {
      gaps.push(gap);
    },
    onRuntime: async () => {},
  };
  return { sink, requests, gaps, sourceMaps };
}

test('enables the CDP domains capture depends on', async () => {
  const fake = new FakeChromeAdapter();
  const { sink } = collectingSink();
  await new CdpSession(fake, sink).start(1);

  const methods = fake.commands.map((c) => c.method);
  expect(methods).toContain('Network.enable');
  expect(methods).toContain('Page.enable');
  expect(methods).toContain('Debugger.enable');
  expect(methods).toContain('Runtime.enable');
});

test('raises the network buffer so large bundles are not evicted', async () => {
  const fake = new FakeChromeAdapter();
  const { sink } = collectingSink();
  await new CdpSession(fake, sink).start(1);

  const enable = fake.commands.find((c) => c.method === 'Network.enable');
  expect(Number(enable!.params.maxResourceBufferSize)).toBeGreaterThanOrEqual(
    100 * 1024 * 1024
  );
  expect(Number(enable!.params.maxTotalBufferSize)).toBeGreaterThanOrEqual(
    500 * 1024 * 1024
  );
});

test('fetches the response body only once loading has finished', async () => {
  const fake = new FakeChromeAdapter();
  fake.respondWith('Network.getResponseBody', () => ({
    body: '{"ok":true}',
    base64Encoded: false,
  }));
  const { sink, requests } = collectingSink();
  const session = new CdpSession(fake, sink);
  await session.start(1);

  fake.emit(1, 'Network.requestWillBeSent', {
    requestId: 'r1',
    wallTime: 1756029600,
    request: { url: 'https://x.com/api/me', method: 'GET', headers: {} },
    type: 'XHR',
  });
  expect(
    fake.commands.some((c) => c.method === 'Network.getResponseBody')
  ).toBe(false);

  fake.emit(1, 'Network.responseReceived', {
    requestId: 'r1',
    response: { status: 200, headers: {}, mimeType: 'application/json' },
  });
  fake.emit(1, 'Network.loadingFinished', { requestId: 'r1' });
  await Bun.sleep(0);

  expect(requests).toHaveLength(1);
  expect(requests[0]!.body).toBe('{"ok":true}');
});

test('decodes base64 response bodies', async () => {
  const fake = new FakeChromeAdapter();
  fake.respondWith('Network.getResponseBody', () => ({
    body: btoa('binary-ish'),
    base64Encoded: true,
  }));
  const { sink, requests } = collectingSink();
  await new CdpSession(fake, sink).start(1);

  fake.emit(1, 'Network.requestWillBeSent', {
    requestId: 'r1',
    wallTime: 1756029600,
    request: { url: 'https://x.com/a.png', method: 'GET', headers: {} },
    type: 'Image',
  });
  fake.emit(1, 'Network.responseReceived', {
    requestId: 'r1',
    response: { status: 200, headers: {}, mimeType: 'image/png' },
  });
  fake.emit(1, 'Network.loadingFinished', { requestId: 'r1' });
  await Bun.sleep(0);

  expect(requests[0]!.body).toBe('binary-ish');
});

test('an evicted body becomes a gap rather than a dropped request', async () => {
  const fake = new FakeChromeAdapter();
  fake.respondWith('Network.getResponseBody', () => {
    throw new Error('No resource with given identifier found');
  });
  const { sink, gaps, requests } = collectingSink();
  await new CdpSession(fake, sink).start(1);

  fake.emit(1, 'Network.requestWillBeSent', {
    requestId: 'r1',
    wallTime: 1756029600,
    request: { url: 'https://x.com/chunk-47.js', method: 'GET', headers: {} },
    type: 'Script',
  });
  fake.emit(1, 'Network.responseReceived', {
    requestId: 'r1',
    response: { status: 200, headers: {}, mimeType: 'application/javascript' },
  });
  fake.emit(1, 'Network.loadingFinished', { requestId: 'r1' });
  await Bun.sleep(0);

  expect(gaps).toHaveLength(1);
  expect(gaps[0]!.reason).toBe('body-evicted');
  expect(gaps[0]!.url).toBe('https://x.com/chunk-47.js');
  // The request itself is still recorded — only its body is missing.
  expect(requests).toHaveLength(1);
  expect(requests[0]!.body).toBeNull();
});

test('a failed load is recorded as a gap', async () => {
  const fake = new FakeChromeAdapter();
  const { sink, gaps } = collectingSink();
  await new CdpSession(fake, sink).start(1);

  fake.emit(1, 'Network.requestWillBeSent', {
    requestId: 'r1',
    wallTime: 1756029600,
    request: { url: 'https://x.com/blocked.js', method: 'GET', headers: {} },
    type: 'Script',
  });
  fake.emit(1, 'Network.loadingFailed', {
    requestId: 'r1',
    errorText: 'net::ERR_BLOCKED_BY_CLIENT',
    canceled: false,
  });
  await Bun.sleep(0);

  expect(gaps[0]!.detail).toBe('net::ERR_BLOCKED_BY_CLIENT');
});

test('runs the introspection probes after a navigation completes', async () => {
  const fake = new FakeChromeAdapter();
  fake.respondWith('Runtime.evaluate', () => ({
    result: { value: [] },
  }));
  const { sink } = collectingSink();
  await new CdpSession(fake, sink).start(1);

  fake.emit(1, 'Page.loadEventFired', {});
  await Bun.sleep(0);

  const evaluations = fake.commands.filter((c) => c.method === 'Runtime.evaluate');
  expect(evaluations.length).toBeGreaterThanOrEqual(3);
  expect(evaluations.every((c) => c.params.returnByValue === true)).toBe(true);
});

test('detaching stops the debugger cleanly', async () => {
  const fake = new FakeChromeAdapter();
  const { sink } = collectingSink();
  const session = new CdpSession(fake, sink);
  await session.start(1);
  expect(fake.attached).toContain(1);

  await session.stop();
  expect(fake.attached).not.toContain(1);
});

test('scriptParsed fetches and keeps a source map with sourcesContent', async () => {
  const mapText = JSON.stringify({
    version: 3,
    sources: ['src/App.tsx'],
    sourcesContent: ['export const App = () => null;'],
    mappings: 'AAAA',
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(mapText, { status: 200 })) as unknown as typeof fetch;

  try {
    const fake = new FakeChromeAdapter();
    const { sink, sourceMaps } = collectingSink();
    await new CdpSession(fake, sink).start(1);

    fake.emit(1, 'Debugger.scriptParsed', {
      url: 'https://x.com/assets/app-a1b2.js',
      sourceMapURL: 'app-a1b2.js.map',
    });
    await Bun.sleep(0);

    expect(sourceMaps).toHaveLength(1);
    expect(sourceMaps[0]!.scriptUrl).toBe('https://x.com/assets/app-a1b2.js');
    expect(JSON.parse(sourceMaps[0]!.text).sourcesContent[0]).toContain('App');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('scriptParsed discards a 404 HTML page served for a speculative .map', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("<!doctype html><html>404</html>", { status: 200 })) as unknown as typeof fetch;

  try {
    const fake = new FakeChromeAdapter();
    const { sink, sourceMaps } = collectingSink();
    await new CdpSession(fake, sink).start(1);

    fake.emit(1, 'Debugger.scriptParsed', {
      url: 'https://x.com/assets/app-a1b2.js',
      sourceMapURL: null,
    });
    await Bun.sleep(0);

    expect(sourceMaps).toHaveLength(0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
