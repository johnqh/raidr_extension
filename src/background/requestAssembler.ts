import type { CapturedRequest, Gap } from '@sudobility/xray_lib';

export interface AssembledRequest
  extends Omit<CapturedRequest, 'requestBodyHash' | 'responseBodyHash'> {
  requestBody: string | null;
}

interface Pending {
  id: string;
  ts: number;
  method: string;
  url: string;
  resourceType: string;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  navigationId: string | null;
  status: number | null;
  responseHeaders: Record<string, string>;
  mimeType: string | null;
  fromCache: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function asHeaders(value: unknown): Record<string, string> {
  const source = asRecord(value);
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(source)) {
    out[key.toLowerCase()] = String(raw);
  }
  return out;
}

/**
 * Only the page's own traffic belongs in a bundle.
 *
 * A tab carries requests from every other installed extension too, and those
 * were being recorded: a real capture of one site contained two unrelated
 * `chrome-extension://` hosts. That is noise in the analysis and someone else's
 * data in an artifact the operator may share.
 */
function isCapturableScheme(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export class RequestAssembler {
  private pending = new Map<string, Pending>();
  private navigationId: string | null = null;

  setNavigationId(navigationId: string): void {
    this.navigationId = navigationId;
  }

  pendingCount(): number {
    return this.pending.size;
  }

  onRequestWillBeSent(params: Record<string, unknown>): void {
    const requestId = String(params.requestId ?? '');
    if (!requestId) return;
    const request = asRecord(params.request);
    if (!isCapturableScheme(String(request.url ?? ''))) return;
    const wallTime = Number(params.wallTime ?? 0);

    this.pending.set(requestId, {
      id: requestId,
      ts: Math.round(wallTime * 1000),
      method: String(request.method ?? 'GET'),
      url: String(request.url ?? ''),
      resourceType: String(params.type ?? 'Other'),
      requestHeaders: asHeaders(request.headers),
      requestBody:
        typeof request.postData === 'string' ? request.postData : null,
      navigationId: this.navigationId,
      status: null,
      responseHeaders: {},
      mimeType: null,
      fromCache: false,
    });
  }

  onResponseReceived(params: Record<string, unknown>): void {
    const requestId = String(params.requestId ?? '');
    const entry = this.pending.get(requestId);
    if (!entry) return;

    const response = asRecord(params.response);
    entry.status = Number(response.status ?? 0);
    entry.responseHeaders = asHeaders(response.headers);
    entry.mimeType =
      typeof response.mimeType === 'string' ? response.mimeType : null;
    entry.fromCache = response.fromDiskCache === true;
    if (typeof params.type === 'string') entry.resourceType = params.type;
  }

  onLoadingFinished(requestId: string): AssembledRequest | null {
    const entry = this.pending.get(requestId);
    if (!entry) return null;
    this.pending.delete(requestId);

    return {
      id: entry.id,
      ts: entry.ts,
      method: entry.method,
      url: entry.url,
      resourceType: entry.resourceType,
      requestHeaders: entry.requestHeaders,
      requestBody: entry.requestBody,
      status: entry.status,
      responseHeaders: entry.responseHeaders,
      mimeType: entry.mimeType,
      fromCache: entry.fromCache,
      navigationId: entry.navigationId,
    };
  }

  onLoadingFailed(
    requestId: string,
    errorText: string,
    canceled: boolean
  ): Gap | null {
    const entry = this.pending.get(requestId);
    if (!entry) return null;
    this.pending.delete(requestId);

    return {
      requestId,
      url: entry.url,
      reason: canceled ? 'cdp-error' : 'cors-opaque',
      ts: entry.ts,
      detail: errorText,
    };
  }
}
