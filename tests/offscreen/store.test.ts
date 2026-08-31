import { expect, test } from 'bun:test';
import 'fake-indexeddb/auto';
import { sha256Hex } from '../../src/offscreen/hash';
import { IdbContentStore } from '../../src/offscreen/store';

const encoder = new TextEncoder();
let dbCounter = 0;
function freshStore() {
  dbCounter += 1;
  return new IdbContentStore(`raidr-test-${dbCounter}`, indexedDB);
}

test('hashes bytes to stable lowercase hex', async () => {
  const hash = await sha256Hex(encoder.encode('hello'));
  expect(hash).toBe(
    '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
  );
});

test('put returns the content hash', async () => {
  const store = freshStore();
  const hash = await store.put(encoder.encode('hello'));
  expect(hash).toBe(await sha256Hex(encoder.encode('hello')));
});

test('round-trips stored bytes', async () => {
  const store = freshStore();
  const hash = await store.put(encoder.encode('payload'));
  const got = await store.get(hash);
  expect(new TextDecoder().decode(got!)).toBe('payload');
});

test('get returns null for an unknown hash', async () => {
  const store = freshStore();
  expect(await store.get('deadbeef')).toBeNull();
});

test('deduplicates identical content', async () => {
  const store = freshStore();
  await store.put(encoder.encode('same'));
  await store.put(encoder.encode('same'));
  expect(await store.count()).toBe(1);
});

test('tracks total stored bytes without double counting duplicates', async () => {
  const store = freshStore();
  await store.put(encoder.encode('12345'));
  await store.put(encoder.encode('12345'));
  await store.put(encoder.encode('123'));
  expect(await store.totalBytes()).toBe(8);
});

test('has reports presence', async () => {
  const store = freshStore();
  const hash = await store.put(encoder.encode('x'));
  expect(await store.has(hash)).toBe(true);
  expect(await store.has('nope')).toBe(false);
});
