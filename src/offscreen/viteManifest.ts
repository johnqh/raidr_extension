/**
 * Recovers a Vite app's full chunk list from a captured script body.
 *
 * Vite keeps the list in the dynamic-import helper it emits into every chunk
 * that lazily imports another:
 *
 *   const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/a.js",…])))=>i.map(i=>d[i])
 *
 * That is the only complete enumeration of an app's chunks — crucially it
 * includes the lazy route chunks a session never loads, which are exactly the
 * ones the coverage meter exists to report as missing. A page probe cannot
 * read it: the helper is declared `const` inside a module chunk, so it never
 * reaches the page's global scope (checked against production builds — the
 * global is always undefined). Fetching the script from the page to parse it
 * would also write the probe's own requests into the capture.
 *
 * The response body the extension already captured has it, at no extra cost.
 */

/**
 * Anchored on the helper's name rather than its parameter names, which a
 * future Vite is free to rename. The window is bounded so a stray `m.f=` far
 * below an unrelated mention of the helper cannot be mistaken for its list.
 */
const DEPS = /__vite__mapDeps[\s\S]{0,120}?m\.f=(\[[^\]]*\])/g;

export function viteChunksFromSource(source: string): string[] {
  const chunks: string[] = [];

  for (const match of source.matchAll(DEPS)) {
    let deps: unknown;
    try {
      deps = JSON.parse(match[1]!);
    } catch {
      // Not the helper after all — a source map, or a chunk that merely
      // mentions the name. A guess here would invent chunks that do not exist.
      continue;
    }
    if (!Array.isArray(deps)) continue;

    for (const dep of deps) {
      // The dep list carries stylesheets alongside chunks. Coverage counts
      // script chunks, and `loadedChunks` joins them to request URLs by
      // suffix, so a `.css` entry would sit in the meter as forever missing.
      if (typeof dep !== 'string' || !dep.endsWith('.js')) continue;
      if (!chunks.includes(dep)) chunks.push(dep);
    }
  }

  return chunks;
}
