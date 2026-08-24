import { useState } from 'react';
import type { RedactionEntry } from '@sudobility/xray_lib';
import { RedactionReport } from './components/RedactionReport';

export function SidePanel() {
  const [entries] = useState<RedactionEntry[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <main className="p-4 text-sm">
      <h1 className="font-semibold">xray</h1>

      <RedactionReport
        entries={entries}
        acknowledged={acknowledged}
        onAcknowledge={() => setAcknowledged((prev) => !prev)}
      />

      <button
        type="button"
        disabled={!acknowledged}
        onClick={() => chrome.runtime.sendMessage({ kind: 'export/start' })}
        className="mt-3 w-full rounded bg-black px-3 py-2 text-white disabled:opacity-40"
      >
        Export bundle
      </button>
    </main>
  );
}
