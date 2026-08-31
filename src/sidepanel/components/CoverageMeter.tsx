import { Badge, Card, CardContent, Progress } from '@sudobility/components';
import type { CoverageReport } from '@sudobility/raidr_lib';

interface Props {
  report: CoverageReport;
}

/** Full coverage is the goal, so the bar only turns green when it is reached. */
function toneFor(pct: number): 'success' | 'warning' | 'default' {
  if (pct >= 100) return 'success';
  if (pct >= 60) return 'default';
  return 'warning';
}

function Track({
  label,
  pct,
  detail,
  missing,
  missingLabel,
}: {
  label: string;
  pct: number;
  detail: string;
  missing: string[];
  missingLabel: string;
}) {
  return (
    <div className="mb-4 last:mb-0">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-xs font-medium">{label}</span>
        <span className="font-mono text-xs text-muted-foreground">{detail}</span>
      </div>

      <Progress value={pct} variant={toneFor(pct)} size="sm" />

      {missing.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            {missing.length} {missingLabel}
          </summary>
          <ul className="mt-1.5 space-y-0.5">
            {missing.map((item) => (
              <li key={item} className="truncate font-mono text-[11px] text-muted-foreground">
                {item}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function CoverageMeter({ report }: Props) {
  return (
    <Card className="border border-border">
      <CardContent className="pt-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Coverage</h2>
          <Badge variant={report.complete ? 'success' : 'warning'} size="sm" pill>
            {report.complete ? 'Complete' : 'Incomplete'}
          </Badge>
        </div>

        <Track
          label="Chunks"
          pct={report.chunks.pct}
          detail={`${report.chunks.loaded} / ${report.chunks.known}`}
          missing={report.chunks.missing}
          missingLabel="not loaded"
        />
        <Track
          label="Routes"
          pct={report.routes.pct}
          detail={`${report.routes.visited} / ${report.routes.total}`}
          missing={report.routes.unvisited}
          missingLabel="not visited"
        />

        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            {report.endpoints.length} endpoints observed
          </summary>
          <ul className="mt-1.5 space-y-0.5">
            {report.endpoints.map((endpoint) => (
              <li key={endpoint.key} className="flex items-baseline justify-between gap-2">
                <span className="truncate font-mono text-[11px]">{endpoint.key}</span>
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {endpoint.calls}
                </span>
              </li>
            ))}
          </ul>
        </details>
      </CardContent>
    </Card>
  );
}
