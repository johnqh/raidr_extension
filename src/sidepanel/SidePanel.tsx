import { useEffect, useState } from 'react';
import type { CoverageReport, RedactionEntry } from '@sudobility/xray_lib';
import { isXrayMessage } from '@/shared/messages';
import { CoverageMeter } from './components/CoverageMeter';
import { RedactionReport } from './components/RedactionReport';

const EMPTY_REPORT: CoverageReport = {
  chunks: { known: 0, loaded: 0, pct: 100, missing: [] },
  routes: { total: 0, visited: 0, pct: 100, unvisited: [] },
  endpoints: [],
  complete: true,
};

export function SidePanel() {
  const [capturing, setCapturing] = useState(false);
  const [report, setReport] = useState<CoverageReport>(EMPTY_REPORT);
  const [entries] = useState<RedactionEntry[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    const listener = (message: unknown) => {
      if (!isXrayMessage(message)) return;
      if (message.kind === 'session/coverage') setReport(message.report);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const toggle = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    if (capturing) {
      await chrome.runtime.sendMessage({ kind: 'session/stop' });
    } else {
      await chrome.runtime.sendMessage({ kind: 'session/start', tabId: tab.id });
    }
    setCapturing((prev) => !prev);
  };

  return (
    <main className="p-4 text-sm">
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-semibold">xray</h1>
        <button
          type="button"
          onClick={() => void toggle()}
          className="rounded border px-3 py-1 text-xs"
        >
          {capturing ? 'Stop' : 'Start capture'}
        </button>
      </div>

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
