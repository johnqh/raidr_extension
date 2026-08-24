import { zip } from 'fflate';
import {
  contentPath,
  extensionForMime,
  toJsonl,
  type CapturedFrame,
  type CapturedRequest,
  type Gap,
  type RedactionEntry,
  type XrayManifest,
} from '@sudobility/xray_lib';
import type { ContentStore } from './store';

export interface RuntimeArtifacts {
  framework: unknown;
  routes: unknown;
  stores: unknown;
  chunks: unknown;
  coverage: unknown;
}

export interface BundleInput {
  store: ContentStore;
  manifest: XrayManifest;
  requests: CapturedRequest[];
  frames: CapturedFrame[];
  gaps: Gap[];
  redaction: RedactionEntry[];
  runtime: RuntimeArtifacts;
}

const encoder = new TextEncoder();

function json(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value, null, 2));
}

export async function buildBundleFiles(
  input: BundleInput
): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {
    'xray.json': json(input.manifest),
    'network/requests.jsonl': encoder.encode(toJsonl(input.requests)),
    'network/websockets.jsonl': encoder.encode(toJsonl(input.frames)),
    'gaps.json': json(input.gaps),
    'redaction.json': json(input.redaction),
    'runtime/framework.json': json(input.runtime.framework),
    'runtime/routes.json': json(input.runtime.routes),
    'runtime/stores.json': json(input.runtime.stores),
    'runtime/chunks.json': json(input.runtime.chunks),
    'runtime/coverage.json': json(input.runtime.coverage),
  };

  // Extension is derived from the mime type of the request that produced the
  // body. A hash referenced by two requests with different mime types is
  // written once per extension; the bytes are identical either way.
  for (const request of input.requests) {
    const ext = extensionForMime(request.mimeType);
    for (const hash of [request.responseBodyHash, request.requestBodyHash]) {
      if (!hash) continue;
      const path = contentPath(hash, hash === request.requestBodyHash ? 'json' : ext);
      if (files[path]) continue;
      const bytes = await input.store.get(hash);
      if (bytes) files[path] = bytes;
    }
  }

  for (const frame of input.frames) {
    const path = contentPath(frame.payloadHash, 'txt');
    if (files[path]) continue;
    const bytes = await input.store.get(frame.payloadHash);
    if (bytes) files[path] = bytes;
  }

  return files;
}

export function zipBundle(
  files: Record<string, Uint8Array>
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(files, { level: 6 }, (error, data) => {
      if (error) reject(error);
      else resolve(data);
    });
  });
}

export function bundleFilename(origin: string, startedAt: string): string {
  const host = new URL(origin).host;
  const date = startedAt.slice(0, 10).replace(/-/g, '');
  const time = startedAt.slice(11, 16).replace(':', '');
  return `xray-${host}-${date}-${time}.zip`;
}
