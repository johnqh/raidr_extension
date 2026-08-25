import type { Gap, StackFingerprint } from '@sudobility/xray_lib';
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
}

export interface CaptureSink {
  onRequest(
    assembled: AssembledRequest,
    responseBody: string | null
  ): Promise<void>;
  onGap(gap: Gap): Promise<void>;
  onRuntime(snapshot: RuntimeSnapshot): Promise<void>;
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

  async start(tabId: number): Promise<void> {
    this.tabId = tabId;
    await this.adapter.attach(tabId);

    this.adapter.onEvent((eventTabId, method, params) => {
      if (eventTabId !== this.tabId) return;
      void this.handle(method, params);
    });

    await this.adapter.sendCommand(tabId, 'Network.enable', {
      maxResourceBufferSize: MAX_RESOURCE_BUFFER,
      maxTotalBufferSize: MAX_TOTAL_BUFFER,
    });
    await this.adapter.sendCommand(tabId, 'Page.enable');
    await this.adapter.sendCommand(tabId, 'Debugger.enable');
    await this.adapter.sendCommand(tabId, 'Runtime.enable');
  }

  async stop(): Promise<void> {
    if (this.tabId === null) return;
    await this.adapter.detach(this.tabId);
    this.tabId = null;
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
      case 'Page.navigatedWithinDocument':
        this.navigationCounter += 1;
        this.assembler.setNavigationId(`nav${this.navigationCounter}`);
        await this.introspect();
        return;

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

  private async introspect(): Promise<void> {
    if (this.tabId === null) return;

    const evaluate = async <T>(expression: string, fallback: T): Promise<T> => {
      try {
        const result = (await this.adapter.sendCommand(
          this.tabId!,
          'Runtime.evaluate',
          { expression, returnByValue: true }
        )) as { result?: { value?: T } } | undefined;
        return result?.result?.value ?? fallback;
      } catch {
        return fallback;
      }
    };

    const [framework, routes, chunks] = await Promise.all([
      evaluate<StackFingerprint | null>(PROBE_SOURCES.framework, null),
      evaluate<string[]>(PROBE_SOURCES.routes, []),
      evaluate<string[]>(PROBE_SOURCES.chunks, []),
    ]);

    await this.sink.onRuntime({ framework, routes, chunks });
  }
}
