import { isRaidrMessage } from '@/shared/messages';
import { LiveChromeAdapter } from '@/adapters/ChromeAdapter';
import { CdpSession, type CaptureSink } from './cdpSession';

const OFFSCREEN_PATH = 'src/offscreen/index.html';

/**
 * Everything below the message handler runs at the top level, synchronously,
 * every time the service worker starts. MV3 restores only listeners registered
 * that way: anything subscribed from inside an async flow is lost the moment
 * the worker is recycled, which for a capture session means events stop
 * arriving and nothing says so.
 */
const adapter = new LiveChromeAdapter();

let session: CdpSession | null = null;
/** Set while a session is being rebuilt after a worker restart. */
let resuming: Promise<CdpSession | null> | null = null;

interface PersistedSession {
  tabId: number;
  navigationCounter: number;
}

const SESSION_KEY = 'raidr:session';

async function readPersisted(): Promise<PersistedSession | null> {
  const stored = await chrome.storage.session.get(SESSION_KEY);
  return (stored[SESSION_KEY] as PersistedSession | undefined) ?? null;
}

async function persist(value: PersistedSession | null): Promise<void> {
  if (value === null) await chrome.storage.session.remove(SESSION_KEY);
  else await chrome.storage.session.set({ [SESSION_KEY]: value });
}

function notify(message: unknown): void {
  // The side panel may be closed; a message with no receiver is not an error.
  void chrome.runtime.sendMessage(message).catch(() => undefined);
}

/**
 * Delivers a message that must not be dropped.
 *
 * createDocument resolves once the offscreen document exists, which is not the
 * same as its listener being registered. `session/begin` losing that race means
 * no manifest is ever created and export later refuses with "no active
 * session" — for a capture the operator has already finished.
 */
async function deliver(message: unknown, attempts = 20): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await chrome.runtime.sendMessage(message);
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  return false;
}

function buildSink(): CaptureSink {
  return {
    onRequest: async (assembled, body) => {
      notify({ kind: 'capture/request', row: { assembled, body } });
    },
    onGap: async (gap) => notify({ kind: 'capture/gap', gap }),
    onRuntime: async (snapshot) => notify({ kind: 'capture/runtime', snapshot }),
    onNavigation: async (navigation) => {
      notify({ kind: 'capture/navigation', navigation });
      // Navigation ids must keep counting if the worker restarts mid-capture,
      // or a resumed session starts issuing nav1 again and collides.
      const tabId = session?.tabIdOrNull();
      if (session && typeof tabId === 'number') {
        await persist({ tabId, navigationCounter: session.navigationCount() });
      }
    },
    onSourceMap: async (scriptUrl, _mapUrl, text) =>
      notify({ kind: 'capture/sourcemap', scriptUrl, text }),
  };
}

async function ensureOffscreen(): Promise<void> {
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  if (existing.length > 0) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [chrome.offscreen.Reason.BLOBS],
    justification:
      'Holds the capture buffer and builds the export archive; a service worker cannot, because it is terminated when idle.',
  });
}

/** Rebuilds the session after a worker restart, using the still-live attachment. */
async function resumeIfNeeded(): Promise<CdpSession | null> {
  if (session) return session;
  if (resuming) return resuming;

  resuming = (async () => {
    const persisted = await readPersisted();
    if (!persisted) return null;

    await ensureOffscreen();
    const rebuilt = new CdpSession(adapter, buildSink());
    rebuilt.setNavigationCounter(persisted.navigationCounter);
    try {
      await rebuilt.start(persisted.tabId, { resume: true });
    } catch (error) {
      await persist(null);
      notify({
        kind: 'session/error',
        detail: `Could not resume capture: ${String(error)}`,
      });
      return null;
    }
    session = rebuilt;
    return rebuilt;
  })();

  const result = await resuming;
  resuming = null;
  return result;
}

// --- Top-level listeners. These are the whole point of this file's shape. ---

adapter.onEvent((tabId, method, params) => {
  void (async () => {
    const active = await resumeIfNeeded();
    await active?.handleEvent(tabId, method, params);
  })();
});

adapter.onDetach((tabId, reason) => {
  void (async () => {
    // DevTools opening on the tab, the debugging banner being dismissed, or the
    // tab closing all detach us. Capture is over; saying so is the difference
    // between a bundle the operator knows is short and one they trust.
    session = null;
    await persist(null);
    notify({ kind: 'session/detached', tabId, reason });
  })();
});

async function startSession(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  const url = tab.url ?? '';
  if (!/^https?:/i.test(url)) {
    notify({
      kind: 'session/error',
      detail: 'raidr can only capture http and https pages.',
    });
    return;
  }

  await ensureOffscreen();
  const begun = await deliver({ kind: 'session/begin', origin: new URL(url).origin });
  if (!begun) {
    notify({
      kind: 'session/error',
      detail: 'The capture buffer did not start. Reload the extension and try again.',
    });
    return;
  }

  const started = new CdpSession(adapter, buildSink());
  try {
    await started.start(tabId);
  } catch (error) {
    // Most often: DevTools is already open on this tab, holding the protocol.
    notify({
      kind: 'session/error',
      detail: `Could not attach to the tab: ${String(error)}`,
    });
    return;
  }

  session = started;
  await persist({ tabId, navigationCounter: 0 });
  notify({ kind: 'session/started', tabId });
}

async function stopSession(): Promise<void> {
  const active = await resumeIfNeeded();
  try {
    await active?.stop();
  } catch {
    // Already detached; stopping is still the right outcome.
  }
  session = null;
  await persist(null);
  notify({ kind: 'session/stopped' });
}

chrome.runtime.onMessage.addListener((message) => {
  if (!isRaidrMessage(message)) return;

  switch (message.kind) {
    case 'session/start':
      void startSession(message.tabId);
      return;
    case 'session/stop':
      void stopSession();
      return;
    case 'export/ready':
      void chrome.downloads.download({
        url: message.blobUrl,
        filename: message.filename,
        saveAs: true,
      });
      return;
    default:
      return;
  }
});

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error: unknown) => console.error('[raidr] side panel', error));

void ensureOffscreen();
