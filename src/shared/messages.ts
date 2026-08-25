import type { Gap, XrayManifest } from '@sudobility/xray_lib';

export interface SessionStats {
  requests: number;
  bodies: number;
  bytes: number;
  gaps: number;
  /** Share of the origin's storage quota in use, when the browser reports it. */
  quotaPct: number | null;
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
  | { kind: 'capture/runtime'; snapshot: import('@/background/cdpSession').RuntimeSnapshot }
  | { kind: 'session/begin'; origin: string }
  | { kind: 'session/redaction'; entries: import('@sudobility/xray_lib').RedactionEntry[] }
  | { kind: 'capture/sourcemap'; scriptUrl: string; text: string }
  | { kind: 'capture/navigation'; navigation: import('@/background/cdpSession').NavigationRecord }
  | { kind: 'session/started'; tabId: number }
  | { kind: 'session/stopped' }
  | { kind: 'session/detached'; tabId: number; reason: string }
  | { kind: 'session/error'; detail: string };

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
  'session/begin',
  'session/redaction',
  'capture/sourcemap',
  'capture/navigation',
  'session/started',
  'session/stopped',
  'session/detached',
  'session/error',
]);

export function isXrayMessage(value: unknown): value is XrayMessage {
  if (typeof value !== 'object' || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  return typeof kind === 'string' && KINDS.has(kind);
}
