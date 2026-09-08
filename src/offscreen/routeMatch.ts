/**
 * Joins a concrete visited path to a route the app declares.
 *
 * The two are never the same string: a router declares `/users/:id`, while a
 * navigation records `/users/42`. Comparing them directly — which the coverage
 * meter did — leaves every parameterised route permanently unvisited, so an app
 * with one could never reach full route coverage no matter where the operator
 * went.
 *
 * Deliberately not a general path-to-regexp: it understands the two shapes the
 * probes actually read, React Router and Vue Router, and nothing more.
 */

interface Segment {
  /** Matches any single segment rather than comparing literally. */
  param: boolean;
  /** Matches everything left, including nothing at all. */
  splat: boolean;
  /** May be absent from the path entirely. */
  optional: boolean;
  literal: string;
}

function split(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}

function parse(segment: string): Segment {
  if (segment === '*') return { param: false, splat: true, optional: true, literal: '' };

  if (segment.startsWith(':')) {
    // Vue writes constraints and modifiers into the parameter itself:
    // `:id(\d+)`, `:term?`, `:pathMatch(.*)*`. The constraint narrows which
    // paths the router accepts, and honouring it would only ever drop a match
    // the operator really did visit, so the name is all that matters here.
    const modifiers = segment.replace(/\([^)]*\)/g, '');
    return {
      param: true,
      splat: modifiers.endsWith('*') || modifiers.endsWith('+'),
      optional: modifiers.endsWith('?') || modifiers.endsWith('*'),
      literal: '',
    };
  }

  return { param: false, splat: false, optional: false, literal: segment };
}

export function matchesRoutePattern(pattern: string, path: string): boolean {
  const patternSegments = split(pattern).map(parse);
  const pathSegments = split(path);

  let index = 0;
  for (const segment of patternSegments) {
    if (segment.splat) return true;

    if (index >= pathSegments.length) {
      // A path that ran out still matches while only optional parts remain.
      if (segment.optional) continue;
      return false;
    }

    if (!segment.param && segment.literal !== pathSegments[index]) return false;
    index += 1;
  }

  return index === pathSegments.length;
}
