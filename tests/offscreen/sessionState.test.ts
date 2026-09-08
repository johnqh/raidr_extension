import { expect, test } from 'bun:test';
import 'fake-indexeddb/auto';
import { IdbContentStore } from '../../src/offscreen/store';
import { SessionState } from '../../src/offscreen/sessionState';
import type { AssembledRequest } from '../../src/background/requestAssembler';

function session() {
  const state = new SessionState(
    new IdbContentStore(`raidr-session-${Math.random()}`, indexedDB),
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
    new IdbContentStore(`raidr-none-${Math.random()}`, indexedDB),
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
    links: [],
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
    links: [],
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
  state.ingestRuntime({ framework: null, routes: ['/', '/settings'], chunks: [], links: [] });
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

test('a navigation is recorded and marks its route visited', async () => {
  // Regression: the extension observed every navigation but discarded the URL,
  // and markVisited was dead code — so the coverage meter could never mark
  // anything visited and the route model had nothing to join on.
  const state = session();
  await state.ingestNavigation({
    navigationId: 'nav1',
    path: '/league',
    origin: null,
    sameDocument: true,
    html: null,
  });

  const report = state.coverage();
  expect(report.routes.total).toBe(1);
  expect(report.routes.visited).toBe(1);
  expect(report.routes.unvisited).toEqual([]);
  expect(state.bundleInput().runtime.navigations).toEqual([
    { navigationId: 'nav1', path: '/league', sameDocument: true },
  ]);
});

test('a client-rendered navigation stores the rendered DOM', async () => {
  const state = session();
  await state.ingestNavigation({
    navigationId: 'nav1',
    path: '/league',
    origin: null,
    sameDocument: true,
    html: '<html><body>league</body></html>',
  });

  const snapshots = state.bundleInput().snapshots!;
  expect(Object.keys(snapshots)).toEqual(['/league']);
  const stored = await state.bundleInput().store.get(snapshots['/league']!);
  expect(new TextDecoder().decode(stored!)).toContain('league');
});

test('links a page offers become known routes, so coverage is not falsely 100%', async () => {
  const state = session();
  await state.ingestNavigation({
    navigationId: 'nav1',
    path: '/',
    origin: null,
    sameDocument: false,
    html: null,
  });
  state.ingestRuntime({
    framework: null,
    routes: [],
    chunks: [],
    links: ['/', '/league', '/vanguard', '/cv'],
  });

  const report = state.coverage();
  expect(report.routes.total).toBe(4);
  expect(report.routes.visited).toBe(1);
  expect(report.routes.unvisited.sort()).toEqual(['/cv', '/league', '/vanguard']);
  expect(report.complete).toBe(false);
});

test('revisiting a route does not double-count it', async () => {
  const state = session();
  for (const navigationId of ['nav1', 'nav2']) {
    await state.ingestNavigation({ navigationId, path: '/league', origin: null, sameDocument: true, html: null });
  }
  expect(state.coverage().routes.total).toBe(1);
  expect(state.bundleInput().runtime.navigations).toHaveLength(2);
});

test('a full page load corrects the origin seeded at session start', async () => {
  // Regression: capture started on one site and navigated to another produced a
  // bundle of ivan.icu whose manifest — and filename — said github.com.
  const state = session();
  expect(state.manifest()!.origin).toBe('https://example.com');

  await state.ingestNavigation({
    navigationId: 'nav1',
    path: '/',
    origin: 'https://www.ivan.icu',
    sameDocument: false,
    html: null,
  });
  expect(state.manifest()!.origin).toBe('https://www.ivan.icu');
});

test('a client-side navigation does not rewrite the origin', async () => {
  const state = session();
  await state.ingestNavigation({
    navigationId: 'nav1',
    path: '/',
    origin: 'https://www.ivan.icu',
    sameDocument: false,
    html: null,
  });
  await state.ingestNavigation({
    navigationId: 'nav2',
    path: '/league',
    origin: 'https://cdn.other.com',
    sameDocument: true,
    html: null,
  });
  expect(state.manifest()!.origin).toBe('https://www.ivan.icu');
});

test('a later snapshot of the same route replaces an earlier one', async () => {
  // Routers commonly touch history twice per click. The first navigation fires
  // before the new route renders, so its DOM still shows the previous page —
  // keeping the first snapshot names every page after the one before it.
  const state = session();
  await state.ingestNavigation({
    navigationId: 'nav1',
    path: '/league',
    origin: null,
    sameDocument: true,
    html: '<html><body>STALE previous page</body></html>',
  });
  await state.ingestNavigation({
    navigationId: 'nav2',
    path: '/league',
    origin: null,
    sameDocument: true,
    html: '<html><body>RENDERED league</body></html>',
  });

  const hash = state.bundleInput().snapshots!['/league']!;
  const stored = await state.bundleInput().store.get(hash);
  expect(new TextDecoder().decode(stored!)).toContain('RENDERED league');
});

/**
 * The lazy route chunks are the whole point of the meter, and no page probe
 * can see them: Vite's dep list never reaches the page's global scope.
 */
test('a captured vite chunk teaches the session about chunks never loaded', async () => {
  const state = session();
  const script: AssembledRequest = {
    ...assembled('https://example.com/assets/App-xorPPbGf.js', 'r9'),
    resourceType: 'Script',
    mimeType: 'text/javascript',
  };
  await state.ingestRequest(
    script,
    'const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=' +
      '["assets/App-xorPPbGf.js","assets/Admin-c3d4.js"])))=>i.map(i=>d[i]);'
  );

  const report = state.coverage();
  expect(report.chunks.known).toBe(2);
  // Only the chunk actually requested counts as loaded.
  expect(report.chunks.loaded).toBe(1);
  expect(report.chunks.missing).toEqual(['assets/Admin-c3d4.js']);
});

test('a non-script response is not scanned for a chunk manifest', async () => {
  const state = session();
  await state.ingestRequest(
    assembled('https://example.com/api/config'),
    '{"note":"__vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=[\\"assets/x.js\\"])))"}'
  );
  expect(state.coverage().chunks.known).toBe(0);
});

test('a concrete visit marks the declared route it matches as visited', async () => {
  const state = session();
  state.ingestRuntime({
    framework: null,
    routes: ['/', '/users/:id', '/admin'],
    chunks: [],
    links: [],
  });
  state.markVisited('/users/42');

  const report = state.coverage();
  expect(report.routes.total).toBe(3);
  expect(report.routes.visited).toBe(1);
  expect(report.routes.unvisited).toEqual(['/', '/admin']);
});

/** Every link in a nav bar is not a page the bundle has to contain. */
test('links stay out of the denominator when the router is readable', async () => {
  const state = session();
  state.ingestRuntime({
    framework: null,
    routes: ['/', '/settings'],
    chunks: [],
    links: ['/about', '/pricing', '/blog/hello', '/blog/world', '/careers'],
  });

  const report = state.coverage();
  expect(report.routes.total).toBe(2);
  expect(state.links()).toHaveLength(5);
});

/** A server-rendered site exposes no route table; links are the only signal. */
test('links become the denominator when no router is readable', async () => {
  const state = session();
  state.ingestRuntime({
    framework: null,
    routes: [],
    chunks: [],
    links: ['/about', '/pricing'],
  });
  state.markVisited('/about');

  const report = state.coverage();
  expect(report.routes.total).toBe(2);
  expect(report.routes.visited).toBe(1);
  expect(report.routes.unvisited).toEqual(['/pricing']);
});

test('a visited path the route table never declared is still counted', async () => {
  const state = session();
  state.ingestRuntime({ framework: null, routes: ['/'], chunks: [], links: [] });
  state.markVisited('/undeclared');

  const report = state.coverage();
  expect(report.routes.total).toBe(2);
  expect(report.routes.visited).toBe(1);
  expect(report.routes.unvisited).toEqual(['/']);
});

/** The bundle keeps seeing everything discovered; only the meter is narrowed. */
test('the bundle still records declared routes and links together', async () => {
  const state = session();
  state.ingestRuntime({
    framework: null,
    routes: ['/settings'],
    chunks: [],
    links: ['/about'],
  });
  state.markVisited('/dashboard');

  const routes = state.bundleInput().runtime.routes as string[];
  expect(routes).toContain('/settings');
  expect(routes).toContain('/about');
  expect(routes).toContain('/dashboard');
});
