import { Card, CardContent, Progress } from '@sudobility/components';
import type { CoverageReport } from '@sudobility/raidr_lib';

interface Props {
  report: CoverageReport;
  /**
   * Internal links the pages offer. Reported, never scored: a nav bar and a
   * footer are not a list of pages the bundle has to contain, and counting
   * them held every capture short of complete for reasons nobody could act on.
   */
  links: string[];
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
  /**
   * Omitted when there is no honest denominator to measure against, in which
   * case no bar is drawn — a progress bar with an invented total reads as
   * certainty the capture does not have.
   */
  pct?: number;
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

      {pct !== undefined && <Progress value={pct} variant={toneFor(pct)} size="sm" />}

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

export function CoverageMeter({ report, links }: Props) {
  return (
    <Card className="border border-border">
      <CardContent className="pt-4">
        {/*
          No completion badge. Coverage is a map of what was reached, not a bar
          to clear: a bundle can be everything reconstruction needs while most
          routes went unvisited, and labelling that "Incomplete" told the
          operator to keep clicking for no benefit.
        */}
        <h2 className="mb-3 text-sm font-semibold">Coverage</h2>

        {/*
          A count, not a ratio. The denominator would have to be every chunk the
          app has, and nothing here can know that: a lazy chunk the session
          never discovered is absent from both sides of the fraction, so "13/13"
          and "13/105" were the same capture described two ways.
        */}
        <Track
          label="Chunks captured"
          detail={String(report.chunks.loaded)}
          missing={report.chunks.missing}
          missingLabel="referenced but not captured"
        />
        <Track
          label="Routes"
          pct={report.routes.pct}
          detail={`${report.routes.visited} / ${report.routes.total}`}
          missing={report.routes.unvisited}
          missingLabel="not visited"
        />

        {links.length > 0 && (
          <details className="mb-3">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
              {links.length} links discovered
            </summary>
            <ul className="mt-1.5 space-y-0.5">
              {links.map((link) => (
                <li
                  key={link}
                  className="truncate font-mono text-[11px] text-muted-foreground"
                >
                  {link}
                </li>
              ))}
            </ul>
          </details>
        )}

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
