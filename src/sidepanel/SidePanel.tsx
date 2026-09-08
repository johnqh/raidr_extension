import { useEffect, useState } from 'react';
import { Alert, Badge, Button } from '@sudobility/components';
import type { CoverageReport, RedactionEntry } from '@sudobility/raidr_lib';
import { isRaidrMessage, type SessionStats } from '@/shared/messages';
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

export function SidePanel() {
  const [status, setStatus] = useState<Status>({ state: 'idle' });
  const [report, setReport] = useState<CoverageReport>(EMPTY_REPORT);
  const [entries, setEntries] = useState<RedactionEntry[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [links, setLinks] = useState<string[]>([]);

  useEffect(() => {
    const listener = (message: unknown) => {
      if (!isRaidrMessage(message)) return;

      switch (message.kind) {
        case 'session/coverage':
          setReport(message.report);
          setLinks(message.links);
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

  return (
    <main className="min-h-screen bg-background p-4 text-foreground">
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-semibold">raidr</h1>
          {capturing && (
            <Badge variant="danger" size="sm" dot pill>
              Recording
            </Badge>
          )}
          {status.state === 'stopped' && (
            <Badge variant="default" size="sm" pill>
              Stopped
            </Badge>
          )}
        </div>

        <Button
          variant={capturing ? 'outline' : 'default'}
          size="sm"
          onClick={() => void toggle()}
        >
          {capturing ? 'Stop' : 'Start capture'}
        </Button>
      </header>

      {status.state === 'error' && (
        <Alert variant="error" className="mb-4" description={status.detail} />
      )}

      {stats && (
        <p className="mb-4 font-mono text-xs text-muted-foreground">
          {stats.requests} requests · {(stats.bytes / 1048576).toFixed(1)} MB
          {stats.gaps > 0 && ` · ${stats.gaps} gaps`}
        </p>
      )}

      {stats !== null && stats.quotaPct !== null && stats.quotaPct >= 80 && (
        <Alert
          variant="warning"
          className="mb-4"
          title={`Browser storage is ${stats.quotaPct}% full`}
          description="Export now — a capture that exceeds the quota fails at the end, when it is too late to redo."
        />
      )}

      <CoverageMeter report={report} links={links} />

      <RedactionReport
        entries={entries}
        acknowledged={acknowledged}
        onAcknowledge={() => setAcknowledged((prev) => !prev)}
      />

      <Button
        variant="default"
        className="mt-4 w-full"
        disabled={!acknowledged}
        onClick={() => void chrome.runtime.sendMessage({ kind: 'export/start' })}
      >
        Export bundle
      </Button>
    </main>
  );
}
