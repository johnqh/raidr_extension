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
