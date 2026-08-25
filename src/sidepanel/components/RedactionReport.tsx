import { Badge, Card, CardContent, Checkbox } from '@sudobility/components';
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
    <Card className="mt-3 border border-border">
      <CardContent className="pt-4">
        <h2 className="mb-3 text-sm font-semibold">Redaction</h2>

        {entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing redacted yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {Array.from(byKind.entries()).map(([kind, count]) => (
              <li key={kind} className="flex items-center justify-between gap-2">
                <Badge variant="info" size="sm">
                  {kind}
                </Badge>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {count}
                </span>
              </li>
            ))}
          </ul>
        )}

        {entries.length > 0 && (
          <details className="mt-2.5">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
              Sample placeholders
            </summary>
            <ul className="mt-1.5 space-y-0.5">
              {entries.slice(0, 10).map((entry) => (
                <li key={entry.placeholder} className="font-mono text-[11px] text-muted-foreground">
                  {entry.placeholder}
                </li>
              ))}
            </ul>
          </details>
        )}

        <div className="mt-4 flex items-start gap-2">
          <Checkbox
            id="xray-redaction-ack"
            checked={acknowledged}
            onChange={onAcknowledge}
          />
          <label htmlFor="xray-redaction-ack" className="text-xs leading-snug">
            I have reviewed what will leave the browser
          </label>
        </div>
      </CardContent>
    </Card>
  );
}
