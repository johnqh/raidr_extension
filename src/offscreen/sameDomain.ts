/**
 * Decides whether a recorded URL belongs to the captured site's own domain.
 *
 * Export uses this to keep a bundle to one site. Matching is on the
 * registrable domain rather than the exact host, so `api.opendota.com` counts
 * as the same site as `www.opendota.com` — an API on its own subdomain is the
 * normal shape of a web app, and excluding it would leave a bundle with no
 * endpoints to model.
 *
 * Note what this does *not* do: an asset CDN on another domain is excluded even
 * though the page loaded it. That is the rule's cost, and it is deliberate.
 */

/**
 * Public suffixes of two labels, where the registrable domain is three labels
 * deep. Not the full Public Suffix List — that is a large, frequently changing
 * dataset, and this is the head of it. A suffix missing here yields a domain
 * one label too short, which over-includes rather than silently dropping data.
 */
const TWO_LABEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'net.uk', 'sch.uk',
  'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'go.jp',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.nz', 'net.nz', 'org.nz', 'govt.nz',
  'com.br', 'com.cn', 'com.mx', 'com.tr', 'com.tw', 'com.sg', 'com.hk',
  'co.in', 'co.za', 'co.kr', 'co.il', 'co.id', 'co.th',
]);

/** True for an address that has no domain structure to reduce. */
function isLiteralHost(host: string): boolean {
  if (!host.includes('.')) return true;
  // IPv4. IPv6 arrives bracketed and contains no dots.
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

export function registrableDomain(host: string): string {
  const lower = host.toLowerCase();
  if (isLiteralHost(lower)) return lower;

  const labels = lower.split('.');
  if (labels.length <= 2) return lower;

  const lastTwo = labels.slice(-2).join('.');
  const depth = TWO_LABEL_SUFFIXES.has(lastTwo) ? 3 : 2;
  return labels.slice(-depth).join('.');
}

export function isSameDomain(url: string, origin: string): boolean {
  let target: string;
  let site: string;
  try {
    target = registrableDomain(new URL(url).hostname);
    site = registrableDomain(new URL(origin).hostname);
  } catch {
    // A URL neither side can parse is not evidence of belonging. Excluding it
    // keeps the rule from being the thing that lets another site's record in.
    return false;
  }
  return target === site && target !== '';
}
