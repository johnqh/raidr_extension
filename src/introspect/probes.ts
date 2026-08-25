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

  // The devtools hooks exist only when the devtools extension is installed, so
  // they cannot be the primary signal. Both frameworks leave unmistakable
  // traces on the DOM itself, which are present in every production build.
  const doc = g.document;
  let vueAppInstance: any = null;
  let reactByDom = false;

  if (doc && doc.querySelectorAll) {
    const candidates = Array.prototype.slice.call(
      doc.querySelectorAll('body, body *'),
      0,
      200
    ) as any[];

    for (const element of candidates) {
      if (!vueAppInstance && element.__vue_app__) vueAppInstance = element.__vue_app__;
      if (!reactByDom) {
        for (const key in element) {
          if (
            key.indexOf('__reactFiber$') === 0 ||
            key.indexOf('__reactContainer$') === 0 ||
            key.indexOf('__reactProps$') === 0
          ) {
            reactByDom = true;
            break;
          }
        }
      }
      if (vueAppInstance && reactByDom) break;
    }
  }

  if (vueAppInstance) {
    framework = 'vue';
    frameworkVersion = vueAppInstance.version ?? vueHook?.Vue?.version ?? null;
  } else if (reactByDom) {
    framework = 'react';
    // Production React does not publish its version to the page; the devtools
    // hook is the only runtime source, and it is usually absent.
    const renderers = reactHook?.renderers
      ? (Array.from(reactHook.renderers.values()) as any[])
      : [];
    frameworkVersion = renderers[0]?.version ?? null;
  } else if (reactHook && reactHook.renderers && reactHook.renderers.size > 0) {
    framework = 'react';
    const renderers = Array.from(reactHook.renderers.values()) as any[];
    frameworkVersion = renderers[0]?.version ?? null;
  } else if (vueHook) {
    framework = 'vue';
    frameworkVersion = vueHook.Vue?.version ?? null;
  }

  let bundler: 'webpack' | 'vite' | 'unknown' = 'unknown';
  const webpackGlobal =
    typeof g.__webpack_require__ !== 'undefined' ||
    Object.keys(g).some((key) => key.indexOf('webpackChunk') === 0);
  if (webpackGlobal) {
    bundler = 'webpack';
  } else if (typeof g.__vite__mapDeps !== 'undefined') {
    bundler = 'vite';
  } else if (doc && doc.querySelector) {
    // Vite production builds emit hashed module scripts under /assets/.
    const moduleScript = doc.querySelector('script[type="module"][src]');
    const src = moduleScript ? String(moduleScript.getAttribute('src')) : '';
    if (/\/assets\/[^/]+-[A-Za-z0-9_-]{6,}\.js/.test(src)) bundler = 'vite';
  }

  const stateLibraries: string[] = [];
  if (g.__REDUX_DEVTOOLS_EXTENSION__ || g.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__) {
    stateLibraries.push('redux');
  }
  if (vueHook && vueHook.Pinia) stateLibraries.push('pinia');

  let router: string | null = null;
  if (vueAppInstance?.config?.globalProperties?.$router) router = 'vue-router';
  else if (g.__reactRouterDataRouter?.routes) router = 'react-router';

  return {
    framework,
    frameworkVersion,
    router,
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

  if (typeof urlHelper !== 'function') {
    // Vite only defines __vite__mapDeps when a dynamic import carries CSS or
    // asset dependencies. Without it the runtime cannot enumerate chunks that
    // have not loaded; the best available signal is what the document
    // references. Unloaded chunks are recovered offline from the entry source.
    const doc = g.document;
    if (doc && doc.querySelectorAll) {
      const referenced: string[] = [];
      const add = (value: unknown): void => {
        const path = String(value ?? '');
        if (!path) return;
        const match = /\/assets\/[^"'\s)]+\.js/.exec(path);
        if (match && referenced.indexOf(match[0].slice(1)) < 0) {
          referenced.push(match[0].slice(1));
        }
      };
      for (const script of Array.prototype.slice.call(
        doc.querySelectorAll('script[type="module"][src]')
      ) as any[]) {
        add(script.getAttribute('src'));
      }
      for (const link of Array.prototype.slice.call(
        doc.querySelectorAll('link[rel="modulepreload"][href]')
      ) as any[]) {
        add(link.getAttribute('href'));
      }
      if (referenced.length > 0) return referenced;
    }
  }
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
