/**
 * The message protocol between the three extension contexts: service worker
 * (`src/background`), offscreen document (`src/offscreen`) and side panel
 * (`src/sidepanel`). All of them use `chrome.runtime.sendMessage`, which
 * broadcasts, so every listener filters by `kind`.
 */
import type { Gap, RaidrManifest } from '@sudobility/raidr_processor';

/** Running totals the offscreen document reports to the side panel. */
export interface SessionStats {
  requests: number;
  bodies: number;
  bytes: number;
  gaps: number;
  /** Share of the origin's storage quota in use, when the browser reports it. */
  quotaPct: number | null;
}

/**
 * Every message the extension exchanges, discriminated by `kind`.
 * `capture/*` flows worker → offscreen. `session/start|stop` go panel →
 * worker, `session/begin` goes worker → offscreen, and the remaining
 * `session/*` kinds report status to the panel (the offscreen document also
 * acts on `session/stopped` and `session/detached`). `export/start` goes
 * panel → offscreen and `export/ready` offscreen → worker, which owns
 * `chrome.downloads`.
 */
export type RaidrMessage =
  | { kind: 'session/start'; tabId: number }
  | { kind: 'session/stop' }
  | { kind: 'session/stats'; stats: SessionStats }
  | { kind: 'capture/request'; row: unknown }
  | { kind: 'capture/body'; hash: string; bytesBase64: string; ext: string }
  | { kind: 'capture/gap'; gap: Gap }
  | { kind: 'export/start' }
  | { kind: 'export/ready'; blobUrl: string; filename: string }
  | { kind: 'export/manifest'; manifest: RaidrManifest }
  | {
      kind: 'session/coverage';
      report: import('@sudobility/raidr_processor').CoverageReport;
      /** Internal links discovered but not scored — see SessionState.links(). */
      links: string[];
    }
  | { kind: 'capture/runtime'; snapshot: import('@/background/cdpSession').RuntimeSnapshot }
  | { kind: 'session/begin'; origin: string }
  | { kind: 'session/redaction'; entries: import('@sudobility/raidr_processor').RedactionEntry[] }
  | { kind: 'capture/sourcemap'; scriptUrl: string; text: string }
  | { kind: 'capture/navigation'; navigation: import('@/background/cdpSession').NavigationRecord }
  | { kind: 'session/started'; tabId: number }
  | { kind: 'session/stopped' }
  | { kind: 'session/detached'; tabId: number; reason: string }
  | { kind: 'session/error'; detail: string };

/**
 * Runtime mirror of `RaidrMessage['kind']`. A kind added to the union but not
 * here is rejected by `isRaidrMessage` and silently ignored by every listener;
 * `tests/messages.test.ts` lists the kinds that are actually sent.
 */
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

/** Narrows an incoming runtime message to `RaidrMessage` by checking its `kind` against `KINDS`. */
export function isRaidrMessage(value: unknown): value is RaidrMessage {
  if (typeof value !== 'object' || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  return typeof kind === 'string' && KINDS.has(kind);
}
