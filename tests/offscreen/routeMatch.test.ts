import { expect, test } from 'bun:test';
import { matchesRoutePattern } from '../../src/offscreen/routeMatch';

test('an exact literal route matches only itself', () => {
  expect(matchesRoutePattern('/settings', '/settings')).toBe(true);
  expect(matchesRoutePattern('/settings', '/settings/billing')).toBe(false);
  expect(matchesRoutePattern('/settings', '/setting')).toBe(false);
});

test('the root route matches the root path', () => {
  expect(matchesRoutePattern('/', '/')).toBe(true);
  expect(matchesRoutePattern('/', '/about')).toBe(false);
});

/** The join the meter was missing: a visit is concrete, a route is a pattern. */
test('a named parameter matches exactly one segment', () => {
  expect(matchesRoutePattern('/users/:id', '/users/42')).toBe(true);
  expect(matchesRoutePattern('/users/:id', '/users/alice')).toBe(true);
  expect(matchesRoutePattern('/users/:id', '/users')).toBe(false);
  expect(matchesRoutePattern('/users/:id', '/users/42/edit')).toBe(false);
  expect(matchesRoutePattern('/users/:id', '/teams/42')).toBe(false);
});

test('parameters match in any position', () => {
  expect(matchesRoutePattern('/org/:org/repo/:repo', '/org/sudobility/repo/raidr')).toBe(true);
  expect(matchesRoutePattern('/org/:org/repo/:repo', '/org/sudobility/repo')).toBe(false);
});

/** Vue Router writes constraints and modifiers into the parameter itself. */
test('ignores a parameter regex constraint', () => {
  expect(matchesRoutePattern('/posts/:id(\\d+)', '/posts/2024')).toBe(true);
});

test('an optional parameter matches with or without the segment', () => {
  expect(matchesRoutePattern('/search/:term?', '/search/boots')).toBe(true);
  expect(matchesRoutePattern('/search/:term?', '/search')).toBe(true);
});

/** React Router's `files/*` matches the bare path as well as any depth under it. */
test('a splat matches the rest of the path, including nothing', () => {
  expect(matchesRoutePattern('/files/*', '/files/a/b/c')).toBe(true);
  expect(matchesRoutePattern('/files/*', '/files/a')).toBe(true);
  expect(matchesRoutePattern('/files/*', '/files')).toBe(true);
  expect(matchesRoutePattern('/files/*', '/other/a')).toBe(false);
});

test('a vue catch-all matches any path', () => {
  expect(matchesRoutePattern('/:pathMatch(.*)*', '/anything/at/all')).toBe(true);
});

test('a trailing slash does not change the match', () => {
  expect(matchesRoutePattern('/settings/', '/settings')).toBe(true);
  expect(matchesRoutePattern('/users/:id', '/users/42/')).toBe(true);
});

test('repeated slashes do not change the match', () => {
  expect(matchesRoutePattern('/users//:id', '/users/42')).toBe(true);
});
