import type { CoverageReport } from '@sudobility/xray_lib';

interface Props {
  report: CoverageReport;
}

function Track({
  label,
  pct,
  detail,
}: {
  label: string;
  pct: number;
  detail: string;
}) {
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs mb-1">
        <span>{label}</span>
        <span className="tabular-nums opacity-70">{detail}</span>
      </div>
      <div className="h-1.5 rounded bg-neutral-200">
        <div
          className="h-1.5 rounded bg-black transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function CoverageMeter({ report }: Props) {
  return (
    <section>
      <Track
        label="Chunks"
        pct={report.chunks.pct}
        detail={`${report.chunks.loaded} / ${report.chunks.known}`}
      />
      <Track
        label="Routes"
        pct={report.routes.pct}
        detail={`${report.routes.visited} / ${report.routes.total}`}
      />

      {report.chunks.missing.length > 0 && (
        <details className="text-xs mb-2">
          <summary className="cursor-pointer opacity-70">
            {report.chunks.missing.length} chunks not loaded
          </summary>
          <ul className="mt-1 font-mono space-y-0.5">
            {report.chunks.missing.map((chunk) => (
              <li key={chunk} className="truncate">{chunk}</li>
            ))}
          </ul>
        </details>
      )}

      {report.routes.unvisited.length > 0 && (
        <details className="text-xs mb-2">
          <summary className="cursor-pointer opacity-70">
            {report.routes.unvisited.length} routes not visited
          </summary>
          <ul className="mt-1 font-mono space-y-0.5">
            {report.routes.unvisited.map((route) => (
              <li key={route} className="truncate">{route}</li>
            ))}
          </ul>
        </details>
      )}

      <details className="text-xs">
        <summary className="cursor-pointer opacity-70">
          {report.endpoints.length} endpoints observed
        </summary>
        <ul className="mt-1 space-y-0.5">
          {report.endpoints.map((endpoint) => (
            <li key={endpoint.key} className="flex justify-between gap-2">
              <span className="font-mono truncate">{endpoint.key}</span>
              <span className="tabular-nums opacity-70">{endpoint.calls}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
