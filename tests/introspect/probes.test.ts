import { expect, test, afterEach } from 'bun:test';
import { PROBE_SOURCES } from '../../src/introspect/probes';

const g = globalThis as Record<string, unknown>;

afterEach(() => {
  delete g.document;
  delete g.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  delete g.__VUE_DEVTOOLS_GLOBAL_HOOK__;
  delete g.__webpack_require__;
  delete g.__vite__mapDeps;
});

function run<T>(source: string): T {
  return new Function(`return (${source});`)() as T;
}

test('probe sources are self-contained and evaluate without module scope', () => {
  for (const source of Object.values(PROBE_SOURCES)) {
    expect(() => run(source)).not.toThrow();
  }
});

test('detects React and its version', () => {
  g.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map([[1, { version: '18.3.1' }]]),
  };
  const result = run<{ framework: string; frameworkVersion: string | null }>(
    PROBE_SOURCES.framework
  );
  expect(result.framework).toBe('react');
  expect(result.frameworkVersion).toBe('18.3.1');
});

test('detects Vue and its version', () => {
  g.__VUE_DEVTOOLS_GLOBAL_HOOK__ = { Vue: { version: '3.4.21' } };
  const result = run<{ framework: string; frameworkVersion: string | null }>(
    PROBE_SOURCES.framework
  );
  expect(result.framework).toBe('vue');
  expect(result.frameworkVersion).toBe('3.4.21');
});

test('reports unknown when no framework is present', () => {
  const result = run<{ framework: string }>(PROBE_SOURCES.framework);
  expect(result.framework).toBe('unknown');
});

test('detects the webpack bundler', () => {
  g.__webpack_require__ = () => undefined;
  expect(run<{ bundler: string }>(PROBE_SOURCES.framework).bundler).toBe('webpack');
});

test('detects the vite bundler', () => {
  g.__vite__mapDeps = () => [];
  expect(run<{ bundler: string }>(PROBE_SOURCES.framework).bundler).toBe('vite');
});

test('reads the webpack chunk manifest from the url helper', () => {
  const u = (id: string) => `static/js/${id}.chunk.js`;
  // webpack embeds the id→name map inside the source of `u`.
  u.toString = () =>
    'function u(e){return"static/js/"+({12:"about",47:"admin"}[e])+".chunk.js"}';
  const webpackRequire = (() => undefined) as unknown as Record<string, unknown>;
  webpackRequire.u = u;
  g.__webpack_require__ = webpackRequire;

  const chunks = run<string[]>(PROBE_SOURCES.chunks);
  expect(chunks).toEqual([
    'static/js/12.chunk.js',
    'static/js/47.chunk.js',
  ]);
});

test('reads the vite chunk manifest from viteFileDeps', () => {
  const mapDeps = (() => []) as unknown as Record<string, unknown>;
  mapDeps.viteFileDeps = ['assets/About-a1b2.js', 'assets/Admin-c3d4.js'];
  g.__vite__mapDeps = mapDeps;

  expect(run<string[]>(PROBE_SOURCES.chunks)).toEqual([
    'assets/About-a1b2.js',
    'assets/Admin-c3d4.js',
  ]);
});

test('returns an empty chunk list when no bundler is detected', () => {
  expect(run<string[]>(PROBE_SOURCES.chunks)).toEqual([]);
});

test('reads Vue Router paths', () => {
  g.__VUE_DEVTOOLS_GLOBAL_HOOK__ = {
    apps: [
      {
        app: {
          config: {
            globalProperties: {
              $router: {
                getRoutes: () => [{ path: '/' }, { path: '/settings' }],
              },
            },
          },
        },
      },
    ],
  };
  expect(run<string[]>(PROBE_SOURCES.routes)).toEqual(['/', '/settings']);
});

test('returns an empty route list when no router is reachable', () => {
  expect(run<string[]>(PROBE_SOURCES.routes)).toEqual([]);
});

test('detects React from DOM fiber keys without React DevTools installed', () => {
  // Production React never publishes a global; the devtools hook exists only
  // when the extension is installed. DOM fiber keys are always present.
  const element: Record<string, unknown> = { __reactFiber$abc123: {} };
  g.document = {
    querySelectorAll: () => [element],
    querySelector: () => null,
  };
  const result = run<{ framework: string }>(PROBE_SOURCES.framework);
  expect(result.framework).toBe('react');
});

test('detects Vue and its version from the mounted app instance', () => {
  const element: Record<string, unknown> = {
    __vue_app__: { version: '3.4.21', config: { globalProperties: {} } },
  };
  g.document = {
    querySelectorAll: () => [element],
    querySelector: () => null,
  };
  const result = run<{ framework: string; frameworkVersion: string | null }>(
    PROBE_SOURCES.framework
  );
  expect(result.framework).toBe('vue');
  expect(result.frameworkVersion).toBe('3.4.21');
});

test('detects Vite from hashed module script paths', () => {
  g.document = {
    querySelectorAll: () => [],
    querySelector: (selector: string) =>
      selector.includes('module')
        ? { getAttribute: () => '/assets/index-B6zGc9AK.js' }
        : null,
  };
  expect(run<{ bundler: string }>(PROBE_SOURCES.framework).bundler).toBe('vite');
});

test('detects webpack from a webpackChunk global', () => {
  g.webpackChunkmyapp = [];
  g.document = { querySelectorAll: () => [], querySelector: () => null };
  expect(run<{ bundler: string }>(PROBE_SOURCES.framework).bundler).toBe('webpack');
  delete g.webpackChunkmyapp;
});

test('falls back to document-referenced chunks when no deps map exists', () => {
  g.document = {
    querySelectorAll: (selector: string) =>
      selector.includes('script')
        ? [{ getAttribute: () => '/assets/index-B6zGc9AK.js' }]
        : [{ getAttribute: () => '/assets/Users-CqHBajCK.js' }],
    querySelector: () => null,
  };
  const chunks = run<string[]>(PROBE_SOURCES.chunks);
  expect(chunks).toContain('assets/index-B6zGc9AK.js');
  expect(chunks).toContain('assets/Users-CqHBajCK.js');
});
