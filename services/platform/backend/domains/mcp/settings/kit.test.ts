// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { refusalFromThrown } from '../refusals.ts';
import {
  droppedMembers,
  identifySingle,
  identityOf,
  pageOf,
  parseSettingsConfig,
  SettingsRefusalError,
} from './kit.ts';

function refused(run: () => unknown): SettingsRefusalError {
  try {
    run();
  } catch (error) {
    if (error instanceof SettingsRefusalError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('a handler refusal', () => {
  it('reaches the agent as a refusal with its code, sentence, hint and data', () => {
    expect(
      refusalFromThrown(
        new SettingsRefusalError('SETTINGS_TALE_ONLY', 'made in Tale', {
          hint: 'open Settings',
          data: { area: 'branding' },
        }),
      ),
    ).toEqual({
      error: 'made in Tale',
      code: 'SETTINGS_TALE_ONLY',
      hint: 'open Settings',
      data: { area: 'branding' },
    });
  });
});

describe('reading a change through its kind', () => {
  const policy = z.object({
    minLength: z.number().int().min(8),
    rules: z.array(z.object({ name: z.string() })).default([]),
  });

  it('answers what the writer would store, defaults included', () => {
    expect(
      parseSettingsConfig(policy, { minLength: 12 }, 'the policy'),
    ).toEqual({ minLength: 12, rules: [] });
  });

  it('names every problem by where it is, never by what was sent', () => {
    const error = refused(() =>
      parseSettingsConfig(
        policy,
        { minLength: 'sk-not-a-number', rules: [{ name: 4 }] },
        'the policy',
      ),
    );
    expect(error.code).toBe('SETTINGS_INVALID');
    expect(error.data?.issues).toEqual([
      {
        path: '/config/minLength',
        code: 'invalid_type',
        message: expect.any(String),
      },
      {
        path: '/config/rules/0/name',
        code: 'invalid_type',
        message: expect.any(String),
      },
    ]);
    expect(JSON.stringify(error.data)).not.toContain('sk-not-a-number');
    expect(error.message).toMatch(
      /^the policy is not valid: \/config\/minLength /,
    );
  });

  it('refuses a field the setting does not have instead of dropping it', () => {
    const error = refused(() =>
      parseSettingsConfig(
        policy,
        { minLength: 12, minLenght: 14, rules: [{ name: 'a', nmae: 'b' }] },
        'the policy',
      ),
    );
    expect(error.data?.issues).toEqual([
      {
        path: '/config/minLenght',
        code: 'unrecognized_key',
        message: 'is not a field of this setting',
      },
      {
        path: '/config/rules/0/nmae',
        code: 'unrecognized_key',
        message: 'is not a field of this setting',
      },
    ]);
  });

  it('escapes a member name in its pointer', () => {
    expect(droppedMembers({ 'a/b~c': 1 }, {})).toEqual([
      {
        path: '/config/a~1b~0c',
        code: 'unrecognized_key',
        message: 'is not a field of this setting',
      },
    ]);
  });
});

describe('the identity of a resource', () => {
  it('takes no id for a kind with one resource', () => {
    expect(identifySingle('branding')({ kind: 'branding', op: 'set' })).toBe(
      null,
    );
    expect(
      refused(() =>
        identifySingle('branding')({ kind: 'branding', id: 'x', op: 'set' }),
      ).code,
    ).toBe('SETTINGS_ID_INVALID');
  });

  it('takes the id named, the one the config carries, or both when they agree', () => {
    expect(identityOf('provider', 'vendor', undefined, 'its name')).toBe(
      'vendor',
    );
    expect(identityOf('provider', undefined, 'vendor', 'its name')).toBe(
      'vendor',
    );
    expect(identityOf('provider', 'vendor', 'vendor', 'its name')).toBe(
      'vendor',
    );
    expect(
      refused(() => identityOf('provider', 'vendor', 'other', 'its name')).code,
    ).toBe('SETTINGS_ID_INVALID');
    expect(
      refused(() => identityOf('provider', undefined, undefined, 'its name'))
        .code,
    ).toBe('SETTINGS_ID_REQUIRED');
  });
});

describe('pages of a listing', () => {
  const items = Array.from({ length: 5 }, (_, index) => index);

  it('walks a listing page by page with the cursor each page answers', () => {
    const first = pageOf(items, undefined, 2);
    expect(first).toEqual({ items: [0, 1], nextCursor: 'p2' });
    const second = pageOf(items, first.nextCursor ?? undefined, 2);
    expect(second).toEqual({ items: [2, 3], nextCursor: 'p4' });
    expect(pageOf(items, second.nextCursor ?? undefined, 2)).toEqual({
      items: [4],
      nextCursor: null,
    });
  });

  it.each(['', '2', 'p0', 'p-1', 'p01', 'pp2'])(
    'refuses the cursor %j, which no page answered',
    (cursor) => {
      expect(refused(() => pageOf(items, cursor, 2)).code).toBe(
        'INVALID_CURSOR',
      );
    },
  );
});
