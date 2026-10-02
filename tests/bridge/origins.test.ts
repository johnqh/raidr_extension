import { describe, expect, test } from 'bun:test';
import manifest from '../../src/manifest.json';
import { BRIDGE_MATCHES, isBridgeOrigin } from '@/bridge/origins';

describe('bridge origins', () => {
  test('the content script runs exactly where the worker accepts requests from', () => {
    expect(manifest.content_scripts?.[0]?.matches).toEqual([...BRIDGE_MATCHES]);
    expect(manifest.permissions).toContain('webRequest');
  });
  test('isBridgeOrigin', () => {
    expect(isBridgeOrigin('https://raidr.app/en/endpoint')).toBe(true);
    expect(isBridgeOrigin('https://www.raidr.app/')).toBe(true);
    expect(isBridgeOrigin('http://localhost:5144/en')).toBe(true);
    expect(isBridgeOrigin('http://raidr.app/')).toBe(false);
    expect(isBridgeOrigin('https://raidr.app.evil.com/')).toBe(false);
    expect(isBridgeOrigin('https://evilraidr.app/')).toBe(false);
    expect(isBridgeOrigin(undefined)).toBe(false);
  });
});
