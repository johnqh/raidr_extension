import type { StackFingerprint } from '@sudobility/xray_lib';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Every function below is serialized with `.toString()` and evaluated inside
 * the page. They must reference nothing outside their own body.
 */

export function detectFramework(): StackFingerprint {
  const g = globalThis as any;

  let framework: 'react' | 'vue' | 'unknown' = 'unknown';
  let frameworkVersion: string | null = null;

  const reactHook = g.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const vueHook = g.__VUE_DEVTOOLS_GLOBAL_HOOK__;

  if (reactHook && reactHook.renderers && reactHook.renderers.size > 0) {
    framework = 'react';
    const renderers = Array.from(reactHook.renderers.values()) as any[];
    frameworkVersion = renderers[0]?.version ?? null;
  } else if (vueHook) {
    framework = 'vue';
    frameworkVersion = vueHook.Vue?.version ?? null;
  }

  let bundler: 'webpack' | 'vite' | 'unknown' = 'unknown';
  if (typeof g.__webpack_require__ !== 'undefined') bundler = 'webpack';
  else if (typeof g.__vite__mapDeps !== 'undefined') bundler = 'vite';

  const stateLibraries: string[] = [];
  if (g.__REDUX_DEVTOOLS_EXTENSION__ || g.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__) {
    stateLibraries.push('redux');
  }
  if (vueHook && vueHook.Pinia) stateLibraries.push('pinia');

  return {
    framework,
    frameworkVersion,
    router: null,
    routerVersion: null,
    stateLibraries,
    bundler,
  };
}

export function readRoutes(): string[] {
  const g = globalThis as any;
  const paths: string[] = [];

  const vueHook = g.__VUE_DEVTOOLS_GLOBAL_HOOK__;
  const vueApp = vueHook?.apps?.[0]?.app;
  const vueRouter = vueApp?.config?.globalProperties?.$router;
  if (vueRouter && typeof vueRouter.getRoutes === 'function') {
    for (const route of vueRouter.getRoutes()) {
      if (route && typeof route.path === 'string') paths.push(route.path);
    }
    return paths;
  }

  // React Router's data router registers itself for its own devtools.
  const reactRouter = g.__reactRouterDataRouter ?? g.__staticRouterHydrationData;
  const routes = reactRouter?.routes;
  if (Array.isArray(routes)) {
    const walk = (nodes: any[], prefix: string): void => {
      for (const node of nodes) {
        const segment = typeof node.path === 'string' ? node.path : '';
        const full = segment.startsWith('/')
          ? segment
          : `${prefix}/${segment}`.replace(/\/+/g, '/');
        if (segment) paths.push(full);
        if (Array.isArray(node.children)) walk(node.children, full);
      }
    };
    walk(routes, '');
  }

  return paths;
}

export function readChunkManifest(): string[] {
  const g = globalThis as any;

  const viteMapDeps = g.__vite__mapDeps;
  if (viteMapDeps && Array.isArray(viteMapDeps.viteFileDeps)) {
    return viteMapDeps.viteFileDeps.slice();
  }

  const webpackRequire = g.__webpack_require__;
  const urlHelper = webpackRequire?.u;
  if (typeof urlHelper === 'function') {
    // webpack inlines the chunk id→name map into the body of `u`. Recovering
    // the ids from its source is the only way to enumerate chunks that have
    // not loaded yet.
    const source = String(urlHelper);
    const literal = source.match(/\{[^{}]*\}/);
    if (literal) {
      const ids = literal[0].match(/(^|[{,])\s*("?)([\w.-]+)\2\s*:/g) ?? [];
      const chunks: string[] = [];
      for (const raw of ids) {
        const id = raw.replace(/[{,:\s"]/g, '');
        if (!id) continue;
        try {
          chunks.push(String(urlHelper(id)));
        } catch {
          // A chunk id the helper cannot resolve is not a chunk we can fetch.
        }
      }
      return chunks;
    }
  }

  return [];
}

export const PROBE_SOURCES = {
  framework: `(${detectFramework.toString()})()`,
  routes: `(${readRoutes.toString()})()`,
  chunks: `(${readChunkManifest.toString()})()`,
};
