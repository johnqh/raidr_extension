import type { Gap, StackFingerprint } from '@sudobility/xray_lib';
import type { ChromeAdapter } from '@/adapters/ChromeAdapter';
import { RequestAssembler, type AssembledRequest } from './requestAssembler';
import { PROBE_SOURCES } from '@/introspect/probes';

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
