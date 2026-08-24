import type { RedactionEntry } from '@sudobility/xray_lib';

interface Props {
  entries: RedactionEntry[];
  acknowledged: boolean;
  onAcknowledge: () => void;
}

export function RedactionReport({ entries, acknowledged, onAcknowledge }: Props) {
  const byKind = new Map<string, number>();
  for (const entry of entries) {
    byKind.set(entry.kind, (byKind.get(entry.kind) ?? 0) + entry.occurrences);
  }

  return (
    <section className="border-t pt-3 mt-3">
      <h2 className="font-medium mb-2">Redaction report</h2>

      {entries.length === 0 ? (
        <p className="text-xs opacity-70">Nothing redacted yet.</p>
      ) : (
        <ul className="text-xs space-y-1">
          {Array.from(byKind.entries()).map(([kind, count]) => (
            <li key={kind} className="flex justify-between">
              <span>{kind}</span>
              <span className="tabular-nums opacity-70">{count}</span>
            </li>
          ))}
        </ul>
      )}

      <details className="mt-2 text-xs">
        <summary className="cursor-pointer opacity-70">
          Sample placeholders
        </summary>
        <ul className="mt-1 space-y-0.5 font-mono">
          {entries.slice(0, 10).map((entry) => (
            <li key={entry.placeholder}>{entry.placeholder}</li>
          ))}
        </ul>
      </details>

      <label className="flex items-center gap-2 mt-3 text-xs">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={onAcknowledge}
        />
        I have reviewed what will leave the browser
      </label>
    </section>
  );
}
