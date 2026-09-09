import { expect, test } from 'bun:test';
import { registrableDomain, isSameDomain } from '../../src/offscreen/sameDomain';

test('reduces a host to its registrable domain', () => {
  expect(registrableDomain('www.opendota.com')).toBe('opendota.com');
  expect(registrableDomain('api.opendota.com')).toBe('opendota.com');
  expect(registrableDomain('opendota.com')).toBe('opendota.com');
  expect(registrableDomain('cdn.cloudflare.steamstatic.com')).toBe('steamstatic.com');
});

/** A two-part public suffix must not be mistaken for the registrable domain. */
test('handles multi-part public suffixes', () => {
  expect(registrableDomain('www.example.co.uk')).toBe('example.co.uk');
  expect(registrableDomain('shop.example.com.au')).toBe('example.com.au');
});

test('leaves a host that is not a domain name alone', () => {
  expect(registrableDomain('localhost')).toBe('localhost');
  expect(registrableDomain('127.0.0.1')).toBe('127.0.0.1');
});

test('a subdomain of the captured origin is the same domain', () => {
  const origin = 'https://www.opendota.com';
  expect(isSameDomain('https://www.opendota.com/heroes', origin)).toBe(true);
  expect(isSameDomain('https://api.opendota.com/api/heroStats', origin)).toBe(true);
  expect(isSameDomain('https://opendota.com/', origin)).toBe(true);
});

/**
 * The whole point of the rule: a capture must not carry another site's
 * recordings. It also excludes the CDNs the app itself loads from.
 */
test('any other domain is excluded', () => {
  const origin = 'https://www.opendota.com';
  expect(isSameDomain('https://www.reddit.com/r/popular/', origin)).toBe(false);
  expect(isSameDomain('https://cdn.cloudflare.steamstatic.com/x.png', origin)).toBe(false);
  expect(isSameDomain('https://fonts.gstatic.com/s/font.woff2', origin)).toBe(false);
  // A domain that merely ends with the same letters is not a subdomain.
  expect(isSameDomain('https://notopendota.com/', origin)).toBe(false);
  expect(isSameDomain('https://opendota.com.evil.net/', origin)).toBe(false);
});

test('an unparseable url is excluded rather than assumed safe', () => {
  expect(isSameDomain('not a url', 'https://www.opendota.com')).toBe(false);
  expect(isSameDomain('https://www.opendota.com/', 'not a url')).toBe(false);
});
