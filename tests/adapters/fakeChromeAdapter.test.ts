import { expect, test } from 'bun:test';
import { FakeChromeAdapter } from '../support/FakeChromeAdapter';

test('records commands sent to the debuggee', async () => {
  const fake = new FakeChromeAdapter();
  await fake.attach(1);
  await fake.sendCommand(1, 'Network.enable', { maxResourceBufferSize: 10 });
  expect(fake.attached).toContain(1);
  expect(fake.commands).toEqual([
    { tabId: 1, method: 'Network.enable', params: { maxResourceBufferSize: 10 } },
  ]);
});

test('delivers emitted events to listeners', async () => {
  const fake = new FakeChromeAdapter();
  const seen: string[] = [];
  fake.onEvent((_tabId, method) => seen.push(method));
  fake.emit(1, 'Network.requestWillBeSent', { requestId: 'r1' });
  expect(seen).toEqual(['Network.requestWillBeSent']);
});

test('returns configured command responses', async () => {
  const fake = new FakeChromeAdapter();
  fake.respondWith('Network.getResponseBody', () => ({
    body: 'hello',
    base64Encoded: false,
  }));
  const result = await fake.sendCommand(1, 'Network.getResponseBody', { requestId: 'r1' });
  expect(result).toEqual({ body: 'hello', base64Encoded: false });
});

test('rejects when a command is configured to fail', async () => {
  const fake = new FakeChromeAdapter();
  fake.respondWith('Network.getResponseBody', () => {
    throw new Error('No resource with given identifier found');
  });
  await expect(fake.sendCommand(1, 'Network.getResponseBody', {})).rejects.toThrow(
    'No resource with given identifier found'
  );
});
