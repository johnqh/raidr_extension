import { useEffect, useState } from 'react';
import type { CoverageReport, RedactionEntry } from '@sudobility/xray_lib';
import { isXrayMessage, type SessionStats } from '@/shared/messages';
import { CoverageMeter } from './components/CoverageMeter';
import { RedactionReport } from './components/RedactionReport';

const EMPTY_REPORT: CoverageReport = {
  chunks: { known: 0, loaded: 0, pct: 100, missing: [] },
  routes: { total: 0, visited: 0, pct: 100, unvisited: [] },
  endpoints: [],
  complete: true,
};

type Status =
  | { state: 'idle' }
  | { state: 'capturing' }
  | { state: 'stopped' }
  | { state: 'error'; detail: string };

function statusLine(status: Status): { text: string; tone: string } {
  switch (status.state) {
    case 'capturing':
      return { text: 'Capturing', tone: 'text-emerald-600' };
    case 'stopped':
      return { text: 'Stopped', tone: 'text-neutral-500' };
    case 'error':
      return { text: status.detail, tone: 'text-red-600' };
    default:
      return { text: 'Ready', tone: 'text-neutral-500' };
  }
}

export function SidePanel() {
  const [status, setStatus] = useState<Status>({ state: 'idle' });
  const [report, setReport] = useState<CoverageReport>(EMPTY_REPORT);
  const [entries, setEntries] = useState<RedactionEntry[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [stats, setStats] = useState<SessionStats | null>(null);

  useEffect(() => {
    const listener = (message: unknown) => {
      if (!isXrayMessage(message)) return;

      switch (message.kind) {
        case 'session/coverage':
          setReport(message.report);
          return;
        case 'session/redaction':
          setEntries(message.entries);
          return;
        case 'session/stats':
          setStats(message.stats);
          return;
        // The worker confirms; the panel never assumes capture started.
        case 'session/started':
          setStatus({ state: 'capturing' });
          return;
        case 'session/stopped':
          setStatus({ state: 'stopped' });
          return;
        case 'session/detached':
          // DevTools opening, the banner being dismissed, or the tab closing.
          setStatus({
            state: 'error',
            detail: `Capture ended: ${message.reason}. Anything after this point was not recorded.`,
          });
          return;
        case 'session/error':
          setStatus({ state: 'error', detail: message.detail });
          return;
        default:
          return;
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const capturing = status.state === 'capturing';

  const toggle = async () => {
    if (capturing) {
      await chrome.runtime.sendMessage({ kind: 'session/stop' });
      return;
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setStatus({ state: 'error', detail: 'No active tab to capture.' });
      return;
    }
    setStatus({ state: 'idle' });
    await chrome.runtime.sendMessage({ kind: 'session/start', tabId: tab.id });
  };

  const line = statusLine(status);

  return (
    <main className="p-4 text-sm">
      <div className="flex items-center justify-between mb-1">
        <h1 className="font-semibold">xray</h1>
        <button
          type="button"
          onClick={() => void toggle()}
          className="rounded border px-3 py-1 text-xs"
        >
          {capturing ? 'Stop' : 'Start capture'}
        </button>
      </div>

      <p className={`mb-1 text-xs ${line.tone}`} role="status">
        {line.text}
      </p>

      {stats && (
        <p className="mb-4 font-mono text-[11px] text-neutral-500">
          {stats.requests} requests · {(stats.bytes / 1048576).toFixed(1)} MB
          {stats.gaps > 0 && ` · ${stats.gaps} gaps`}
        </p>
      )}

      {stats?.quotaPct !== null && stats !== null && stats.quotaPct >= 80 && (
        <p className="mb-4 border-l-2 border-amber-500 pl-2 text-xs text-amber-700">
          Browser storage is {stats.quotaPct}% full. Export now — a capture that
          exceeds the quota fails at the end, when it is too late to redo.
        </p>
      )}

      <CoverageMeter report={report} />

      <RedactionReport
        entries={entries}
        acknowledged={acknowledged}
        onAcknowledge={() => setAcknowledged((prev) => !prev)}
      />

      <button
        type="button"
        disabled={!acknowledged}
        onClick={() => void chrome.runtime.sendMessage({ kind: 'export/start' })}
        className="mt-3 w-full rounded bg-black px-3 py-2 text-white disabled:opacity-40"
      >
        Export bundle
      </button>
    </main>
  );
}
