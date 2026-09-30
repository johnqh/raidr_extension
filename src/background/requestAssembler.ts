/**
 * Joins the separate CDP Network events for one request id
 * (`requestWillBeSent` → `responseReceived` → `loadingFinished`/`loadingFailed`)
 * into a single record. Pure: no chrome.* calls, so it is unit-tested directly.
 */
import type { CapturedRequest, Gap } from '@sudobility/raidr_processor';

/**
 * A `CapturedRequest` before redaction and hashing: the request body is still
 * inline. The offscreen `CapturePipeline` redacts it and swaps bodies for
 * content hashes.
 */
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

/** Normalises CDP headers to lowercase keys with string values. */
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

/**
 * Holds in-flight requests keyed by CDP request id. Requests whose URL is not
 * http(s) are never tracked (see `isCapturableScheme`).
 */
export class RequestAssembler {
  private pending = new Map<string, Pending>();
  private navigationId: string | null = null;

  /** Tags every request started from now on with this navigation. */
  setNavigationId(navigationId: string): void {
    this.navigationId = navigationId;
  }

  /** In-flight requests; exposed for tests. */
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

  /** Completes a request and forgets it; null for an id that was never tracked. */
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

  /**
   * Turns a failed request into a `Gap`, so reconstruction sees it as missing
   * rather than never requested. Cancellation maps to `cdp-error`; any other
   * failure is recorded as `cors-opaque`.
   */
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
