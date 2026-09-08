import {
  computeCoverage,
  createManifest,
  type CapturedFrame,
  type CapturedRequest,
  type CoverageReport,
  type Gap,
  type RedactionEntry,
  type StackFingerprint,
  type RaidrManifest,
} from '@sudobility/raidr_lib';
import type { AssembledRequest } from '@/background/requestAssembler';
import type { NavigationRecord, RuntimeSnapshot } from '@/background/cdpSession';
import { CapturePipeline } from './capturePipeline';
import { viteChunksFromSource } from './viteManifest';
import type { ContentStore } from './store';
import type { BundleInput } from '@sudobility/raidr_lib';

export class SessionState {
  private pipeline: CapturePipeline;
  private currentManifest: RaidrManifest | null = null;
  private gaps: Gap[] = [];
  private frames: CapturedFrame[] = [];
  private knownChunks = new Set<string>();
  private knownRoutes = new Set<string>();
  private visitedRoutes = new Set<string>();
  private framework: StackFingerprint | null = null;
  private sourceMaps = new Map<string, string>();
  private navigations: Array<{ navigationId: string; path: string; sameDocument: boolean }> = [];
  /** route path → content hash of the rendered DOM at navigation time */
  private snapshots = new Map<string, string>();

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
    this.absorbChunkManifest(assembled, body);
    this.refreshCounts();
  }

  /**
   * A captured script may carry the app's own chunk manifest. For Vite it is
   * the only place the extension can learn about the lazy route chunks the
   * operator never visited — the page probe sees just the entry and its
   * modulepreloads, so without this the meter reports a session complete while
   * most of the app was never fetched.
   */
  private absorbChunkManifest(
    assembled: AssembledRequest,
    body: string | null
  ): void {
    if (!body) return;
    const isScript =
      assembled.resourceType === 'Script' ||
      (assembled.mimeType?.includes('javascript') ?? false);
    if (!isScript) return;
    for (const chunk of viteChunksFromSource(body)) this.knownChunks.add(chunk);
  }

  ingestGap(gap: Gap): void {
    this.gaps.push(gap);
    this.refreshCounts();
  }

  /**
   * A navigation is the only record that a page was visited. Discarding its URL
   * — which this did until it was found on a real capture — leaves the coverage
   * meter unable to mark anything visited and the route model with nothing to
   * join on.
   */
  async ingestNavigation(navigation: NavigationRecord): Promise<void> {
    // The origin is seeded from whatever tab was active when capture started,
    // which is wrong the moment the operator navigates elsewhere — it produced
    // a bundle of one site named after another. The first full page load is
    // the authoritative answer.
    if (!navigation.sameDocument && navigation.origin && this.currentManifest) {
      this.currentManifest.origin = navigation.origin;
    }

    if (!this.navigations.some((n) => n.navigationId === navigation.navigationId)) {
      this.navigations.push({
        navigationId: navigation.navigationId,
        path: navigation.path,
        sameDocument: navigation.sameDocument,
      });
    }
    this.knownRoutes.add(navigation.path);
    this.markVisited(navigation.path);

    // A client-rendered route was never served as a document; the rendered DOM
    // is the only evidence of what that page contained. Last write wins: a
    // router that touches history twice per click produces two navigations for
    // the same path, and the later one has had more time to render.
    if (navigation.html) {
      const hash = await this.store.put(new TextEncoder().encode(navigation.html));
      this.snapshots.set(navigation.path, hash);
    }
    this.refreshCounts();
  }

  ingestRuntime(snapshot: RuntimeSnapshot): void {
    for (const chunk of snapshot.chunks) this.knownChunks.add(chunk);
    for (const route of snapshot.routes) this.knownRoutes.add(route);
    // Links the page offers are candidate routes. For an app whose router is
    // not readable, this is what stops the meter from claiming 100% coverage
    // when the operator has seen one page of twelve.
    for (const link of snapshot.links) this.knownRoutes.add(link);
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

  /** Bytes held in the content store, and the share of quota that represents. */
  async storageStats(): Promise<{ bytes: number; quotaPct: number | null }> {
    const bytes = await this.store.totalBytes();
    let quotaPct: number | null = null;
    try {
      const estimate = await navigator.storage.estimate();
      if (estimate.quota && estimate.quota > 0) {
        quotaPct = Math.round(((estimate.usage ?? 0) / estimate.quota) * 100);
      }
    } catch {
      // Storage estimation is unavailable in some contexts; the byte count
      // still tells the operator how large the capture has grown.
    }
    return { bytes, quotaPct };
  }

  manifest(): RaidrManifest | null {
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
      snapshots: Object.fromEntries(this.snapshots),
      runtime: {
        framework: this.framework,
        routes: Array.from(this.knownRoutes),
        stores: this.framework?.stateLibraries ?? [],
        chunks: {
          known: Array.from(this.knownChunks),
          loaded: this.loadedChunks(),
        },
        coverage: this.coverage(),
        navigations: this.navigations,
      },
    };
  }
}
