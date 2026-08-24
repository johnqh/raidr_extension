import {
  computeCoverage,
  createManifest,
  type CapturedFrame,
  type CapturedRequest,
  type CoverageReport,
  type Gap,
  type RedactionEntry,
  type StackFingerprint,
  type XrayManifest,
} from '@sudobility/xray_lib';
import type { AssembledRequest } from '@/background/requestAssembler';
import type { RuntimeSnapshot } from '@/background/cdpSession';
import { CapturePipeline } from './capturePipeline';
import type { ContentStore } from './store';
import type { BundleInput } from './exporter';

export class SessionState {
  private pipeline: CapturePipeline;
  private currentManifest: XrayManifest | null = null;
  private gaps: Gap[] = [];
  private frames: CapturedFrame[] = [];
  private knownChunks = new Set<string>();
  private knownRoutes = new Set<string>();
  private visitedRoutes = new Set<string>();
  private framework: StackFingerprint | null = null;
  private sourceMaps = new Map<string, string>();

  constructor(
    private readonly store: ContentStore,
    salt: string
  ) {
    this.pipeline = new CapturePipeline(store, salt);
  }

  begin(origin: string, startedAt: string, sessionId: string): void {
    this.currentManifest = createManifest({ sessionId, origin, startedAt });
  }

  async ingestRequest(
    assembled: AssembledRequest,
    body: string | null
  ): Promise<void> {
    await this.pipeline.ingest(assembled, body);
    this.refreshCounts();
  }

  ingestGap(gap: Gap): void {
    this.gaps.push(gap);
    this.refreshCounts();
  }

  ingestRuntime(snapshot: RuntimeSnapshot): void {
    for (const chunk of snapshot.chunks) this.knownChunks.add(chunk);
    for (const route of snapshot.routes) this.knownRoutes.add(route);
    if (snapshot.framework) {
      this.framework = snapshot.framework;
      if (this.currentManifest) this.currentManifest.stack = snapshot.framework;
    }
  }

  async ingestSourceMap(scriptUrl: string, text: string): Promise<void> {
    const hash = await this.store.put(new TextEncoder().encode(text));
    this.sourceMaps.set(scriptUrl, hash);
  }

  sourceMapHashes(): Record<string, string> {
    return Object.fromEntries(this.sourceMaps);
  }

  markVisited(path: string): void {
    this.visitedRoutes.add(path);
  }

  /**
   * A known chunk counts as loaded when some captured request URL ends with
   * its manifest path. Manifest entries are build-relative (`assets/x.js`)
   * while requests are absolute, so suffix matching is the join.
   */
  private loadedChunks(): string[] {
    const urls = this.pipeline.rows().map((row) => row.url);
    return Array.from(this.knownChunks).filter((chunk) =>
      urls.some((url) => url.endsWith(chunk))
    );
  }

  private refreshCounts(): void {
    if (!this.currentManifest) return;
    const rows = this.pipeline.rows();
    const bodies = new Set<string>();
    for (const row of rows) {
      if (row.responseBodyHash) bodies.add(row.responseBodyHash);
      if (row.requestBodyHash) bodies.add(row.requestBodyHash);
    }
    this.currentManifest.counts = {
      requests: rows.length,
      frames: this.frames.length,
      bodies: bodies.size,
      gaps: this.gaps.length,
    };
  }

  coverage(): CoverageReport {
    return computeCoverage({
      chunks: {
        known: Array.from(this.knownChunks),
        loaded: this.loadedChunks(),
      },
      routes: Array.from(this.knownRoutes).map((path) => ({
        path,
        visited: this.visitedRoutes.has(path),
      })),
      requests: this.pipeline.rows().map((row) => ({
        method: row.method,
        url: row.url,
        status: row.status,
      })),
    });
  }

  redaction(): RedactionEntry[] {
    return this.pipeline.redactionEntries();
  }

  manifest(): XrayManifest | null {
    return this.currentManifest;
  }

  rows(): CapturedRequest[] {
    return this.pipeline.rows();
  }

  bundleInput(): BundleInput {
    if (!this.currentManifest) throw new Error('session not started');
    return {
      store: this.store,
      manifest: this.currentManifest,
      requests: this.pipeline.rows(),
      frames: this.frames,
      gaps: this.gaps,
      redaction: this.redaction(),
      sourceMaps: this.sourceMapHashes(),
      runtime: {
        framework: this.framework,
        routes: Array.from(this.knownRoutes),
        stores: this.framework?.stateLibraries ?? [],
        chunks: {
          known: Array.from(this.knownChunks),
          loaded: this.loadedChunks(),
        },
        coverage: this.coverage(),
      },
    };
  }
}
