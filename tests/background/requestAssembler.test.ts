import { expect, test } from 'bun:test';
import { RequestAssembler } from '../../src/background/requestAssembler';

function willBeSent(requestId: string, url: string) {
  return {
    requestId,
    wallTime: 1756029600,
    request: {
      url,
      method: 'GET',
      headers: { accept: 'application/json' },
    },
    type: 'XHR',
  };
}

function responseReceived(requestId: string) {
  return {
    requestId,
    response: {
      status: 200,
      headers: { 'content-type': 'application/json' },
      mimeType: 'application/json',
      fromDiskCache: false,
    },
    type: 'XHR',
  };
}

test('assembles a complete request from the CDP lifecycle', () => {
  const assembler = new RequestAssembler();
  assembler.setNavigationId('nav1');
  assembler.onRequestWillBeSent(willBeSent('r1', 'https://example.com/api/users'));
  assembler.onResponseReceived(responseReceived('r1'));
  const record = assembler.onLoadingFinished('r1');

  expect(record).not.toBeNull();
  expect(record!.id).toBe('r1');
  expect(record!.method).toBe('GET');
  expect(record!.url).toBe('https://example.com/api/users');
  expect(record!.status).toBe(200);
  expect(record!.mimeType).toBe('application/json');
  expect(record!.resourceType).toBe('XHR');
  expect(record!.navigationId).toBe('nav1');
});

test('converts CDP wallTime seconds into epoch milliseconds', () => {
  const assembler = new RequestAssembler();
  assembler.onRequestWillBeSent(willBeSent('r1', 'https://example.com/'));
  assembler.onResponseReceived(responseReceived('r1'));
  expect(assembler.onLoadingFinished('r1')!.ts).toBe(1756029600000);
});

test('captures the request body when present', () => {
  const assembler = new RequestAssembler();
  assembler.onRequestWillBeSent({
    requestId: 'r1',
    wallTime: 1756029600,
    request: {
      url: 'https://example.com/api/login',
      method: 'POST',
      headers: {},
      postData: '{"user":"a"}',
    },
    type: 'Fetch',
  });
  assembler.onResponseReceived(responseReceived('r1'));
  const record = assembler.onLoadingFinished('r1');
  expect(record!.requestBody).toBe('{"user":"a"}');
});

test('returns null for an unknown requestId', () => {
  const assembler = new RequestAssembler();
  expect(assembler.onLoadingFinished('nope')).toBeNull();
});

test('finishing a request clears it from pending', () => {
  const assembler = new RequestAssembler();
  assembler.onRequestWillBeSent(willBeSent('r1', 'https://example.com/'));
  assembler.onResponseReceived(responseReceived('r1'));
  expect(assembler.pendingCount()).toBe(1);
  assembler.onLoadingFinished('r1');
  expect(assembler.pendingCount()).toBe(0);
});

test('a failed load becomes a gap, not a silent drop', () => {
  const assembler = new RequestAssembler();
  assembler.onRequestWillBeSent(willBeSent('r1', 'https://cdn.example.com/chunk-47.js'));
  const gap = assembler.onLoadingFailed('r1', 'net::ERR_FAILED', false);

  expect(gap).not.toBeNull();
  expect(gap!.url).toBe('https://cdn.example.com/chunk-47.js');
  expect(gap!.reason).toBe('cors-opaque');
  expect(gap!.detail).toBe('net::ERR_FAILED');
  expect(assembler.pendingCount()).toBe(0);
});

test('a canceled load is recorded with the cdp-error reason', () => {
  const assembler = new RequestAssembler();
  assembler.onRequestWillBeSent(willBeSent('r1', 'https://example.com/x.js'));
  const gap = assembler.onLoadingFailed('r1', 'net::ERR_ABORTED', true);
  expect(gap!.reason).toBe('cdp-error');
});

test('marks cache hits so the exporter can skip refetching', () => {
  const assembler = new RequestAssembler();
  assembler.onRequestWillBeSent(willBeSent('r1', 'https://example.com/app.js'));
  assembler.onResponseReceived({
    requestId: 'r1',
    response: {
      status: 200,
      headers: {},
      mimeType: 'application/javascript',
      fromDiskCache: true,
    },
    type: 'Script',
  });
  expect(assembler.onLoadingFinished('r1')!.fromCache).toBe(true);
});

test('another extension’s traffic in the tab is not captured', () => {
  // A real capture of one website contained two unrelated chrome-extension://
  // hosts — other installed extensions' requests, in a bundle meant to be shared.
  const assembler = new RequestAssembler();
  assembler.onRequestWillBeSent({
    requestId: 'r1',
    wallTime: 1756029600,
    request: {
      url: 'chrome-extension://hhhnfhbnacnpipoagodepnpgncefaebe/inject.js',
      method: 'GET',
      headers: {},
    },
    type: 'Script',
  });
  expect(assembler.pendingCount()).toBe(0);
  expect(assembler.onLoadingFinished('r1')).toBeNull();
});

test('non-web schemes are skipped, http and https are kept', () => {
  const assembler = new RequestAssembler();
  const send = (id: string, url: string) =>
    assembler.onRequestWillBeSent({
      requestId: id,
      wallTime: 1756029600,
      request: { url, method: 'GET', headers: {} },
      type: 'Other',
    });

  send('a', 'data:text/html,hi');
  send('b', 'blob:https://x.com/abc');
  send('c', 'about:blank');
  expect(assembler.pendingCount()).toBe(0);

  send('d', 'https://x.com/real');
  send('e', 'http://x.com/real');
  expect(assembler.pendingCount()).toBe(2);
});
