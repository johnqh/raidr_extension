import type {
  ChromeAdapter,
  CdpEventListener,
  DetachListener,
} from '../../src/adapters/ChromeAdapter';

type CommandHandler = (params: Record<string, unknown>) => unknown;

export class FakeChromeAdapter implements ChromeAdapter {
  readonly attached: number[] = [];
  readonly commands: Array<{
    tabId: number;
    method: string;
    params: Record<string, unknown>;
  }> = [];

  private handlers = new Map<string, CommandHandler>();
  private eventListeners: CdpEventListener[] = [];
  private detachListeners: DetachListener[] = [];

  respondWith(method: string, handler: CommandHandler): void {
    this.handlers.set(method, handler);
  }

  async attach(tabId: number): Promise<void> {
    this.attached.push(tabId);
  }

  async detach(tabId: number): Promise<void> {
    const index = this.attached.indexOf(tabId);
    if (index >= 0) this.attached.splice(index, 1);
  }

  async sendCommand(
    tabId: number,
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<unknown> {
    this.commands.push({ tabId, method, params });
    const handler = this.handlers.get(method);
    return handler ? handler(params) : undefined;
  }

  onEvent(listener: CdpEventListener): void {
    this.eventListeners.push(listener);
  }

  onDetach(listener: DetachListener): void {
    this.detachListeners.push(listener);
  }

  emit(tabId: number, method: string, params: Record<string, unknown>): void {
    for (const listener of this.eventListeners) listener(tabId, method, params);
  }

  emitDetach(tabId: number, reason: string): void {
    for (const listener of this.detachListeners) listener(tabId, reason);
  }
}
