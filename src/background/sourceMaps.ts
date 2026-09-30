/**
 * Source-map discovery for scripts seen via `Debugger.scriptParsed`. Maps are
 * fetched by `CdpSession.discoverSourceMap`; these helpers are pure.
 */

/**
 * URLs worth trying for a script's map, in order: the declared
 * `sourceMappingURL` (resolved against the script, skipped when inline
 * `data:`), then `<script>.map`. Non-http scripts yield none.
 */
export function candidateMapUrls(
  scriptUrl: string,
  declaredMapUrl: string | null
): string[] {
  if (!scriptUrl.startsWith('http')) return [];

  const candidates: string[] = [];

  if (declaredMapUrl && !declaredMapUrl.startsWith('data:')) {
    try {
      candidates.push(new URL(declaredMapUrl, scriptUrl).toString());
    } catch {
      // A malformed declaration is no reason to skip speculation.
    }
  }

  // Even with a declared URL, try the conventional sibling: build tools
  // frequently strip the comment while leaving the file in place.
  const speculative = `${scriptUrl.split('?')[0]}.map`;
  if (!candidates.includes(speculative)) candidates.push(speculative);

  return candidates;
}

/**
 * True when the map embeds at least one non-empty `sourcesContent` entry. A map
 * without it names files but carries no source to reconstruct from.
 */
export function isUsefulSourceMap(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return false;
    const { sourcesContent } = parsed as { sourcesContent?: unknown };
    if (!Array.isArray(sourcesContent)) return false;
    return sourcesContent.some(
      (entry) => typeof entry === 'string' && entry.length > 0
    );
  } catch {
    return false;
  }
}
