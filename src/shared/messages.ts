import type { Gap, XrayManifest } from '@sudobility/xray_lib';

export interface SessionStats {
  requests: number;
  bodies: number;
  bytes: number;
  gaps: number;
}

export type XrayMessage =
  | { kind: 'session/start'; tabId: number }
  | { kind: 'session/stop' }
  | { kind: 'session/stats'; stats: SessionStats }
  | { kind: 'capture/request'; row: unknown }
  | { kind: 'capture/body'; hash: string; bytesBase64: string; ext: string }
  | { kind: 'capture/gap'; gap: Gap }
  | { kind: 'export/start' }
  | { kind: 'export/ready'; blobUrl: string; filename: string }
  | { kind: 'export/manifest'; manifest: XrayManifest }
  | { kind: 'session/coverage'; report: import('@sudobility/xray_lib').CoverageReport }
  | { kind: 'capture/runtime'; snapshot: import('@/background/cdpSession').RuntimeSnapshot };

const KINDS: ReadonlySet<string> = new Set([
  'session/start',
  'session/stop',
  'session/stats',
  'capture/request',
  'capture/body',
  'capture/gap',
  'export/start',
  'export/ready',
  'export/manifest',
  'session/coverage',
  'capture/runtime',
]);

export function isXrayMessage(value: unknown): value is XrayMessage {
  if (typeof value !== 'object' || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  return typeof kind === 'string' && KINDS.has(kind);
}
