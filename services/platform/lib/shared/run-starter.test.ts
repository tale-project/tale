import { describe, expect, it } from 'vitest';

import { parseRunStarter, runStarterUserId } from './run-starter';

/** The one reader of the `startedBy` door format: a person behind `user:`
 * and `api-key:`, nobody behind `trigger:`, and a bare id read as the
 * person it is. */
describe('parseRunStarter', () => {
  it('reads the three documented prefixes', () => {
    expect(parseRunStarter('user:u-1')).toEqual({
      kind: 'user',
      userId: 'u-1',
    });
    expect(parseRunStarter('api-key:u-1')).toEqual({
      kind: 'api-key',
      userId: 'u-1',
    });
    expect(parseRunStarter('trigger:t-1')).toEqual({
      kind: 'trigger',
      triggerId: 't-1',
    });
  });

  it('reads a bare id as the person — project-agent runs and pre-prefix automation runs', () => {
    expect(parseRunStarter('u-1')).toEqual({ kind: 'user', userId: 'u-1' });
  });

  it('names nobody for an empty value, an empty id behind a prefix, or an unknown door', () => {
    for (const raw of [
      '',
      'user:',
      'api-key:',
      'trigger:',
      'system:automation',
    ]) {
      expect(parseRunStarter(raw)).toEqual({ kind: 'unknown', raw });
    }
  });
});

describe('runStarterUserId', () => {
  it('answers the person for a user or keyed start and null otherwise', () => {
    expect(runStarterUserId('user:u-1')).toBe('u-1');
    expect(runStarterUserId('api-key:u-2')).toBe('u-2');
    expect(runStarterUserId('u-3')).toBe('u-3');
    expect(runStarterUserId('trigger:t-1')).toBeNull();
    expect(runStarterUserId('')).toBeNull();
  });
});
