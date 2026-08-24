import { expect, test } from 'bun:test';
import 'fake-indexeddb/auto';
import { IdbContentStore } from '../../src/offscreen/store';
import { SessionState } from '../../src/offscreen/sessionState';
import type { AssembledRequest } from '../../src/background/requestAssembler';

function session() {
  const state = new SessionState(
    new IdbContentStore(`xray-session-${Math.random()}`, indexedDB),
    'salt'
  );
  state.begin('https://example.com', '2026-08-24T10:00:00.000Z', 's1');
  return state;
}

function assembled(url: string, id = 'r1'): AssembledRequest {
  return {
    id,
    ts: 1756029600000,
    method: 'GET',
    url,
    resourceType: 'XHR',
    requestHeaders: {},
    requestBody: null,
    status: 200,
    responseHeaders: {},
    mimeType: 'application/json',
    fromCache: false,
    navigationId: 'nav1',
  };
}

test('begin creates a manifest', () => {
  const state = session();
  expect(state.manifest()!.origin).toBe('https://example.com');
  expect(state.manifest()!.formatVersion).toBe(1);
});

test('manifest is null before begin', () => {
  const state = new SessionState(
    new IdbContentStore(`xray-none-${Math.random()}`, indexedDB),
    'salt'
  );
  expect(state.manifest()).toBeNull();
});

test('ingested requests appear in endpoint coverage', async () => {
  const state = session();
  await state.ingestRequest(assembled('https://example.com/api/users/1'), '{}');
  await state.ingestRequest(assembled('https://example.com/api/users/2', 'r2'), '{}');

  const report = state.coverage();
  expect(report.endpoints).toHaveLength(1);
  expect(report.endpoints[0]!.key).toBe('GET /api/users/{id}');
  expect(report.endpoints[0]!.calls).toBe(2);
});

test('runtime snapshots feed chunk and route coverage', async () => {
  const state = session();
  state.ingestRuntime({
    framework: {
      framework: 'react',
      frameworkVersion: '18.3.1',
      router: null,
      routerVersion: null,
      stateLibraries: [],
      bundler: 'vite',
    },
    routes: ['/', '/settings'],
    chunks: ['a.js', 'b.js'],
  });

  const report = state.coverage();
  expect(report.chunks.known).toBe(2);
  expect(report.routes.total).toBe(2);
  expect(state.manifest()!.stack!.framework).toBe('react');
});

test('a chunk becomes loaded once a request for it is captured', async () => {
  const state = session();
  state.ingestRuntime({
    framework: null,
    routes: [],
    chunks: ['assets/About-a1b2.js', 'assets/Admin-c3d4.js'],
  });
  await state.ingestRequest(
    assembled('https://example.com/assets/About-a1b2.js'),
    'code'
  );

  const report = state.coverage();
  expect(report.chunks.loaded).toBe(1);
  expect(report.chunks.missing).toEqual(['assets/Admin-c3d4.js']);
});

test('a route becomes visited once a navigation reports it', async () => {
  const state = session();
  state.ingestRuntime({ framework: null, routes: ['/', '/settings'], chunks: [] });
  await state.ingestRequest(assembled('https://example.com/settings'), '{}');
  state.markVisited('/settings');

  const report = state.coverage();
  expect(report.routes.visited).toBe(1);
  expect(report.routes.unvisited).toEqual(['/']);
});

test('gaps accumulate and are counted in the manifest', async () => {
  const state = session();
  state.ingestGap({
    requestId: 'r9',
    url: 'https://example.com/chunk-47.js',
    reason: 'body-evicted',
    ts: 1756029601000,
    detail: 'evicted',
  });
  expect(state.bundleInput().gaps).toHaveLength(1);
  expect(state.manifest()!.counts.gaps).toBe(1);
});

test('manifest counts track captured requests and bodies', async () => {
  const state = session();
  await state.ingestRequest(assembled('https://example.com/api/a'), '{"a":1}');
  await state.ingestRequest(assembled('https://example.com/api/b', 'r2'), '{"b":2}');

  expect(state.manifest()!.counts.requests).toBe(2);
  expect(state.manifest()!.counts.bodies).toBe(2);
});

test('redaction entries surface through the session', async () => {
  const state = session();
  await state.ingestRequest(
    assembled('https://example.com/api/login'),
    '{"access_token":"eyJa.b.c"}'
  );
  expect(state.redaction()[0]!.kind).toBe('jwt');
});
