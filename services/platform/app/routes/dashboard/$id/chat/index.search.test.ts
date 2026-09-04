import { describe, expect, it } from 'vitest';

import { Route } from './index';

// Regression coverage for the chat fresh-composer flag. The router parses
// search params as JSON, so a hand-typed `?new=1` arrives as the number 1 —
// the validator used to drop it, the layout then resumed the caller's last
// thread, and a message typed into the "fresh" composer landed there. Every
// spelling of "yes" must normalize to the one value the layout reads
// (`new: true`); anything else must leave the flag ABSENT (never `undefined`),
// so plain links and redirects to /chat need no `search` argument.

function parse(search: Record<string, unknown>) {
  const validate = Route.options.validateSearch;
  if (typeof validate !== 'function') {
    throw new TypeError('chat index route has no search validator');
  }
  return validate(search);
}

describe('chat index search contract', () => {
  it('accepts the boolean the in-app links send', () => {
    expect(parse({ new: true })).toEqual({ new: true });
  });

  it('accepts a hand-typed ?new=1, which the JSON search parser delivers as the number 1', () => {
    expect(parse({ new: 1 })).toEqual({ new: true });
  });

  it('accepts the string forms a custom search parser would deliver', () => {
    expect(parse({ new: '1' })).toEqual({ new: true });
    expect(parse({ new: 'true' })).toEqual({ new: true });
  });

  it('leaves the flag absent when the param is missing', () => {
    const search = parse({});
    expect(search).toEqual({});
    expect(search).not.toHaveProperty('new');
  });

  it('leaves the flag absent for values that do not mean "fresh"', () => {
    for (const value of [false, 0, 2, 'false', '0', 'yes', null]) {
      expect(parse({ new: value })).not.toHaveProperty('new');
    }
  });

  it('keeps a non-empty projectId and drops an empty or non-string one', () => {
    expect(parse({ projectId: 'project_1' })).toEqual({
      projectId: 'project_1',
    });
    expect(parse({ projectId: '' })).not.toHaveProperty('projectId');
    expect(parse({ projectId: 7 })).not.toHaveProperty('projectId');
  });
});
