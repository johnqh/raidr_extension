export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // TypeScript 5.7+ types Uint8Array as Uint8Array<ArrayBufferLike>, which is
  // not assignable to BufferSource (SharedArrayBuffer cannot be excluded).
  // Re-wrapping produces a definitely-ArrayBuffer-backed view.
  const view = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', view);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
