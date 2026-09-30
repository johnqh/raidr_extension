/**
 * The only seam between capture logic and `chrome.debugger`.
 *
 * `CdpSession` talks to this interface rather than to `chrome.*`, so the whole
 * capture path runs under `bun test` against `tests/support/FakeChromeAdapter`.
 */

/** Receives every CDP event for any tab this extension is attached to. */
export type CdpEventListener = (
  tabId: number,
  method: string,
  params: Record<string, unknown>
) => void;

/** Called when Chrome ends a debugger attachment (DevTools opened, banner dismissed, tab closed). */
export type DetachListener = (tabId: number, reason: string) => void;

/**
 * The subset of `chrome.debugger` capture needs. `onEvent` and `onDetach` add
 * listeners and are meant to be called once, from the service worker's top
 * level — see `src/background/index.ts` for why.
 */
export interface ChromeAdapter {
  attach(tabId: number): Promise<void>;
  detach(tabId: number): Promise<void>;
  sendCommand(
    tabId: number,
    method: string,
    params?: Record<string, unknown>
  ): Promise<unknown>;
  onEvent(listener: CdpEventListener): void;
  onDetach(listener: DetachListener): void;
}

/** Protocol version passed to `chrome.debugger.attach`. */
const CDP_VERSION = '1.3';

/**
 * Production adapter over `chrome.debugger`. Events without a `tabId` (target-
 * or extension-scoped sources) are dropped, since capture is always per tab.
 */
export class LiveChromeAdapter implements ChromeAdapter {
  async attach(tabId: number): Promise<void> {
    await chrome.debugger.attach({ tabId }, CDP_VERSION);
  }

  async detach(tabId: number): Promise<void> {
    await chrome.debugger.detach({ tabId });
  }

  async sendCommand(
    tabId: number,
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<unknown> {
    return chrome.debugger.sendCommand({ tabId }, method, params);
  }

  onEvent(listener: CdpEventListener): void {
    chrome.debugger.onEvent.addListener((source, method, params) => {
      if (source.tabId === undefined) return;
      listener(source.tabId, method, (params ?? {}) as Record<string, unknown>);
    });
  }

  onDetach(listener: DetachListener): void {
    chrome.debugger.onDetach.addListener((source, reason) => {
      if (source.tabId === undefined) return;
      listener(source.tabId, reason);
    });
  }
}
