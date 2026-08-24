export type CdpEventListener = (
  tabId: number,
  method: string,
  params: Record<string, unknown>
) => void;

export type DetachListener = (tabId: number, reason: string) => void;

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

const CDP_VERSION = '1.3';

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
