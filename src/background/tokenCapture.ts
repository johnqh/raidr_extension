/**
 * Signs the user in to a site on raidr.app's behalf and hands back the site's
 * token, so the API playground never asks them to dig it out of DevTools.
 *
 * raidr.app (through the bridge content script) asks for a token for one API
 * host. The worker opens the site's sign-in page in its own popup window, in
 * the user's normal profile, so an existing session is picked up at once.
 * Every request that window sends to the API host is read with
 * `extractCredential`; the token is accepted once a request carrying it to one
 * of the host's signed-in-only endpoints (`userPaths`) answers 2xx. Then the
 * window closes and the token goes to the raidr tab that asked, and nowhere
 * else. If the user closes the window first, the request fails with
 * `closed`: a credential that never got a signed-in-only endpoint to answer
 * is most likely a guest token. Only a host with no known signed-in-only
 * endpoints gets the last credential seen back, marked unverified.
 *
 * Only requests from the popup's own tabs to the requested API host are read.
 * State lives in `chrome.storage.session` so a recycled worker carries on.
 */
import {
  type CapturedCredential,
  extractCredential,
  matchesPathTemplate,
  type TokenRequest,
} from '@sudobility/raidr_types';

export interface Watch {
  /** The bridge request id raidr.app is waiting on. */
  id: string;
  /** The raidr tab to answer. */
  senderTabId: number;
  windowId: number;
  request: TokenRequest;
  /** Last credential seen on any request to the host. */
  last: string | null;
  /** Credentials by webRequest request id, until the response arrives. */
  pending: Record<string, string>;
}

export type CaptureOutcome =
  | { kind: 'result'; credential: CapturedCredential }
  | { kind: 'failed'; reason: 'closed' | 'blocked' | 'error'; message?: string };

export interface TokenCaptureDeps {
  openWindow(url: string): Promise<{ windowId: number; tabId: number | null } | null>;
  closeWindow(windowId: number): Promise<void>;
  /** The window a tab belongs to, or null when it is gone. */
  windowOfTab(tabId: number): Promise<number | null>;
  /** Answer the raidr tab that asked. */
  reply(senderTabId: number, id: string, outcome: CaptureOutcome): void;
  load(): Promise<Watch[]>;
  save(watches: Watch[]): Promise<void>;
}

/** webRequest's header list as a plain record. */
export function headerRecord(
  headers: Array<{ name: string; value?: string }> | undefined
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of headers ?? []) {
    if (h.value === undefined) continue;
    const key = h.name.toLowerCase();
    out[key] = out[key] ? `${out[key]}; ${h.value}` : h.value;
  }
  return out;
}

export class TokenCapture {
  private watches: Watch[] | null = null;
  /** tab id → window id, so the hot path rarely asks Chrome. */
  private readonly tabWindows = new Map<number, number | null>();

  constructor(private readonly deps: TokenCaptureDeps) {}

  private async all(): Promise<Watch[]> {
    this.watches ??= await this.deps.load();
    return this.watches;
  }

  private async persist(): Promise<void> {
    await this.deps.save(this.watches ?? []);
  }

  /** True when nothing is being watched: lets the request listeners return early. */
  idle(): boolean {
    return this.watches !== null && this.watches.length === 0;
  }

  async start(id: string, senderTabId: number, request: TokenRequest): Promise<boolean> {
    const watches = await this.all();
    // One sign-in per raidr tab: a new request replaces the old one.
    for (const old of watches.filter((w) => w.senderTabId === senderTabId)) {
      await this.finish(old, null);
    }
    const opened = await this.deps.openWindow(request.loginUrl).catch(() => null);
    if (!opened) {
      this.deps.reply(senderTabId, id, { kind: 'failed', reason: 'blocked' });
      return false;
    }
    if (opened.tabId !== null) this.tabWindows.set(opened.tabId, opened.windowId);
    watches.push({ id, senderTabId, windowId: opened.windowId, request, last: null, pending: {} });
    await this.persist();
    return true;
  }

  async cancel(id: string): Promise<void> {
    const watch = (await this.all()).find((w) => w.id === id);
    if (watch) await this.finish(watch, null);
  }

  private async watchFor(tabId: number, url: string): Promise<Watch | null> {
    if (tabId < 0) return null;
    const watches = await this.all();
    if (watches.length === 0) return null;
    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      return null;
    }
    const candidates = watches.filter((w) => w.request.apiHost === host);
    if (candidates.length === 0) return null;
    if (!this.tabWindows.has(tabId)) {
      this.tabWindows.set(tabId, await this.deps.windowOfTab(tabId).catch(() => null));
    }
    const windowId = this.tabWindows.get(tabId);
    return candidates.find((w) => w.windowId === windowId) ?? null;
  }

  /** `webRequest.onBeforeSendHeaders` (with `extraHeaders`). */
  async onRequest(details: {
    requestId: string;
    tabId: number;
    url: string;
    requestHeaders?: Array<{ name: string; value?: string }>;
  }): Promise<void> {
    const watch = await this.watchFor(details.tabId, details.url);
    if (!watch) return;
    const token = extractCredential(headerRecord(details.requestHeaders), watch.request.auth);
    if (!token) return;
    watch.last = token;
    watch.pending[details.requestId] = token;
    await this.persist();
  }

  /** `webRequest.onCompleted`. */
  async onResponse(details: { requestId: string; tabId: number; url: string; statusCode: number }): Promise<void> {
    const watch = await this.watchFor(details.tabId, details.url);
    if (!watch) return;
    const token = watch.pending[details.requestId];
    if (token === undefined) return;
    delete watch.pending[details.requestId];
    const path = new URL(details.url).pathname;
    const { userPaths } = watch.request;
    const signedInOnly =
      userPaths.length === 0 || userPaths.some((template) => matchesPathTemplate(template, path));
    if (details.statusCode >= 200 && details.statusCode < 300 && signedInOnly) {
      await this.finish(watch, { kind: 'result', credential: { token, verified: true } });
    } else {
      await this.persist();
    }
  }

  /** `windows.onRemoved`: the user closed the sign-in window. */
  async onWindowClosed(windowId: number): Promise<void> {
    const watch = (await this.all()).find((w) => w.windowId === windowId);
    if (!watch) return;
    const unverifiable = watch.request.userPaths.length === 0;
    await this.finish(
      watch,
      watch.last && unverifiable
        ? { kind: 'result', credential: { token: watch.last, verified: false } }
        : { kind: 'failed', reason: 'closed' },
      false
    );
  }

  /** `tabs.onRemoved` for the raidr tab: nobody is waiting any more. */
  async onSenderClosed(tabId: number): Promise<void> {
    this.tabWindows.delete(tabId);
    for (const watch of (await this.all()).filter((w) => w.senderTabId === tabId)) {
      await this.finish(watch, null);
    }
  }

  private async finish(watch: Watch, outcome: CaptureOutcome | null, close = true): Promise<void> {
    this.watches = (await this.all()).filter((w) => w !== watch);
    await this.persist();
    if (outcome) this.deps.reply(watch.senderTabId, watch.id, outcome);
    if (close) await this.deps.closeWindow(watch.windowId).catch(() => undefined);
  }
}
