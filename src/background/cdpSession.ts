import type { Gap, StackFingerprint } from '@sudobility/raidr_lib';
import type { ChromeAdapter } from '@/adapters/ChromeAdapter';
import { RequestAssembler, type AssembledRequest } from './requestAssembler';
import { PROBE_SOURCES } from '@/introspect/probes';
import { candidateMapUrls, isUsefulSourceMap } from './sourceMaps';

/** Statuses that carry no body by definition. Asking for one yields a CDP
 *  error, which must not be recorded as lost capture. */
const BODILESS_STATUSES = new Set([101, 204, 205, 304]);

const MAX_RESOURCE_BUFFER = 100 * 1024 * 1024;
const MAX_TOTAL_BUFFER = 500 * 1024 * 1024;

export interface RuntimeSnapshot {
  framework: StackFingerprint | null;
  routes: string[];
  chunks: string[];
  /** Internal links this page offers — the route table for apps that hide theirs. */
  links: string[];
}

export interface NavigationRecord {
  navigationId: string;
  path: string;
  /** Origin at the moment of navigation; authoritative on a full page load. */
  origin: string | null;
  /** True for a client-side route change, where no Document was ever served. */
  sameDocument: boolean;
  /** Rendered DOM at the moment the navigation settled. */
  html: string | null;
}

export interface CaptureSink {
  onRequest(
    assembled: AssembledRequest,
    responseBody: string | null
  ): Promise<void>;
  onGap(gap: Gap): Promise<void>;
  onRuntime(snapshot: RuntimeSnapshot): Promise<void>;
  onNavigation(navigation: NavigationRecord): Promise<void>;
  onSourceMap(scriptUrl: string, mapUrl: string, text: string): Promise<void>;
}

function decodeBody(result: unknown): string | null {
  if (typeof result !== 'object' || result === null) return null;
  const { body, base64Encoded } = result as {
    body?: unknown;
    base64Encoded?: unknown;
  };
  if (typeof body !== 'string') return null;
  return base64Encoded === true ? atob(body) : body;
}

export class CdpSession {
  private assembler = new RequestAssembler();
  private tabId: number | null = null;
  private navigationCounter = 0;
  private attemptedMaps = new Set<string>();

  constructor(
    private readonly adapter: ChromeAdapter,
    private readonly sink: CaptureSink
  ) {}

  /**
   * Attaches and enables the domains capture needs.
   *
   * Deliberately does NOT subscribe to CDP events. A listener registered here
   * is registered from inside a message handler, and MV3 only restores
   * listeners that were registered synchronously while the service worker
   * script was first evaluated. Subscribing here means that the moment the
   * worker is recycled — roughly 30 seconds of no activity — every subsequent
   * event is dropped and capture dies without saying so. The worker owns the
   * subscription and forwards to `handleEvent`.
   */
  async start(tabId: number, options: { resume?: boolean } = {}): Promise<void> {
    this.tabId = tabId;

    if (!options.resume) {
      await this.adapter.attach(tabId);
    } else {
      // Resuming after a worker restart: the attachment outlives the worker, so
      // re-attaching throws. Enabling the domains again is harmless.
      try {
        await this.adapter.attach(tabId);
      } catch {
        // Already attached by us, which is exactly what we want.
      }
    }

    await this.adapter.sendCommand(tabId, 'Network.enable', {
      maxResourceBufferSize: MAX_RESOURCE_BUFFER,
      maxTotalBufferSize: MAX_TOTAL_BUFFER,
    });
    await this.adapter.sendCommand(tabId, 'Page.enable');
    await this.adapter.sendCommand(tabId, 'Debugger.enable');
    await this.adapter.sendCommand(tabId, 'Runtime.enable');

    // Capture is started on a page the operator already has open, so its load
    // event fired long before we attached. Introspecting only from the
    // navigation handler means a session where nothing navigates never learns
    // the chunk manifest or the route table at all, and the coverage meter
    // reports "0 / 0" chunks for its whole life.
    await this.introspect();
  }

  async stop(): Promise<void> {
    if (this.tabId === null) return;
    await this.adapter.detach(this.tabId);
    this.tabId = null;
  }

  /** Entry point for CDP events, called by the service worker's top-level listener. */
  async handleEvent(
    tabId: number,
    method: string,
    params: Record<string, unknown>
  ): Promise<void> {
    if (tabId !== this.tabId) return;
    return this.handle(method, params);
  }

  /** Navigation ids must keep counting across a worker restart. */
  setNavigationCounter(value: number): void {
    this.navigationCounter = value;
  }

  navigationCount(): number {
    return this.navigationCounter;
  }

  tabIdOrNull(): number | null {
    return this.tabId;
  }

  private async handle(
    method: string,
    params: Record<string, unknown>
  ): Promise<void> {
    switch (method) {
      case 'Network.requestWillBeSent':
        this.assembler.onRequestWillBeSent(params);
        return;

      case 'Network.responseReceived':
        this.assembler.onResponseReceived(params);
        return;

      case 'Network.loadingFinished':
        await this.finish(String(params.requestId ?? ''));
        return;

      case 'Network.loadingFailed': {
        const gap = this.assembler.onLoadingFailed(
          String(params.requestId ?? ''),
          String(params.errorText ?? 'unknown'),
          params.canceled === true
        );
        if (gap) await this.sink.onGap(gap);
        return;
      }

      case 'Debugger.scriptParsed':
        await this.discoverSourceMap(
          String(params.url ?? ''),
          typeof params.sourceMapURL === 'string' ? params.sourceMapURL : null
        );
        return;

      case 'Page.loadEventFired':
      case 'Page.navigatedWithinDocument': {
        const sameDocument = method === 'Page.navigatedWithinDocument';
        this.navigationCounter += 1;
        const navigationId = `nav${this.navigationCounter}`;
        this.assembler.setNavigationId(navigationId);

        // CDP hands us the URL on a same-document navigation; after a full load
        // we ask the page. Either way the path must be recorded — a navigation
        // whose URL was discarded is a page nobody can tell was ever visited.
        let path = '/';
        let origin: string | null = null;
        if (sameDocument && typeof params.url === 'string') {
          try {
            const url = new URL(params.url);
            path = url.pathname;
            origin = url.origin;
          } catch {
            path = String(params.url);
          }
        } else {
          const href = await this.evaluate<string>(PROBE_SOURCES.href, '');
          try {
            const url = new URL(href);
            path = url.pathname;
            origin = url.origin;
          } catch {
            path = '/';
          }
        }

        // A client-rendered route was never served as a document, so the
        // rendered DOM is the only evidence that page existed.
        const html = sameDocument
          ? await this.evaluate<string>(PROBE_SOURCES.dom, '', true)
          : null;

        await this.sink.onNavigation({
          navigationId,
          path,
          origin,
          sameDocument,
          html: html && html.length > 0 ? html : null,
        });
        await this.introspect();
        return;
      }

      default:
        return;
    }
  }

  private async finish(requestId: string): Promise<void> {
    const assembled = this.assembler.onLoadingFinished(requestId);
    if (!assembled || this.tabId === null) return;

    if (
      assembled.method === 'HEAD' ||
      (assembled.status !== null && BODILESS_STATUSES.has(assembled.status))
    ) {
      await this.sink.onRequest(assembled, null);
      return;
    }

    let body: string | null = null;
    try {
      const result = await this.adapter.sendCommand(
        this.tabId,
        'Network.getResponseBody',
        { requestId }
      );
      body = decodeBody(result);
    } catch (error) {
      // The body was evicted from Chrome's buffer before we asked for it. The
      // request is still recorded; the missing body becomes an explicit gap so
      // reconstruction never silently invents it.
      await this.sink.onGap({
        requestId,
        url: assembled.url,
        reason: 'body-evicted',
        ts: assembled.ts,
        detail: error instanceof Error ? error.message : String(error),
      });
    }

    await this.sink.onRequest(assembled, body);
  }

  private async discoverSourceMap(
    scriptUrl: string,
    declaredMapUrl: string | null
  ): Promise<void> {
    for (const mapUrl of candidateMapUrls(scriptUrl, declaredMapUrl)) {
      if (this.attemptedMaps.has(mapUrl)) continue;
      this.attemptedMaps.add(mapUrl);
      try {
        const response = await fetch(mapUrl, { credentials: 'include' });
        if (!response.ok) continue;
        const text = await response.text();
        if (!isUsefulSourceMap(text)) continue;
        await this.sink.onSourceMap(scriptUrl, mapUrl, text);
        return;
      } catch {
        // A missing or blocked map is the common case, not an error worth
        // recording as a gap: the bundle is still complete without it.
      }
    }
  }

  private async evaluate<T>(
    expression: string,
    fallback: T,
    awaitPromise = false
  ): Promise<T> {
    if (this.tabId === null) return fallback;
    try {
      const result = (await this.adapter.sendCommand(this.tabId, 'Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise,
      })) as { result?: { value?: T } } | undefined;
      return result?.result?.value ?? fallback;
    } catch {
      return fallback;
    }
  }

  private async introspect(): Promise<void> {
    if (this.tabId === null) return;

    const [framework, routes, chunks, links] = await Promise.all([
      this.evaluate<StackFingerprint | null>(PROBE_SOURCES.framework, null),
      this.evaluate<string[]>(PROBE_SOURCES.routes, []),
      this.evaluate<string[]>(PROBE_SOURCES.chunks, []),
      this.evaluate<string[]>(PROBE_SOURCES.links, []),
    ]);

    await this.sink.onRuntime({ framework, routes, chunks, links });
  }
}
