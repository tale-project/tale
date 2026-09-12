// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest';

import {
  compileSchema,
  compileSchemaCached,
  describeSchemaErrors,
  resetCompiledSchemaCacheForTests,
} from './schema.ts';

const inputs = {
  type: 'object',
  required: ['orderId'],
  properties: {
    orderId: { type: 'string' },
    nested: { type: 'object', properties: { amount: { type: 'number' } } },
    'a/b': { type: 'string' },
  },
  additionalProperties: false,
};

afterEach(() => {
  resetCompiledSchemaCacheForTests();
});

describe('compileSchemaCached', () => {
  it('compiles once per key and answers the same check afterwards', () => {
    const first = compileSchemaCached('org/name@1:100', inputs);
    expect(compileSchemaCached('org/name@1:100', inputs)).toBe(first);
    expect(compileSchemaCached('org/name@1:200', inputs)).not.toBe(first);
    expect(first({ orderId: 'o-1' })).toBe(true);
    expect(first({})).toBe(false);
  });

  it('keeps working across the Ajv instance cache being cleared by later compiles', () => {
    const shared = 'https://tale.test/shared-input';
    const cached = compileSchemaCached('k', { ...inputs, $id: shared });
    // Another compile of the same $id clears the instance cache — the
    // cached check is a closed function and must not depend on it.
    compileSchema({ ...inputs, $id: shared });
    expect(cached({ orderId: 'o-1' })).toBe(true);
  });

  it('forgets everything on the test reset', () => {
    const first = compileSchemaCached('k', inputs);
    resetCompiledSchemaCacheForTests();
    expect(compileSchemaCached('k', inputs)).not.toBe(first);
  });
});

describe('describeSchemaErrors', () => {
  const check = compileSchema(inputs);
  const issuesOf = (value: unknown) => {
    check(value);
    return describeSchemaErrors(check.errors);
  };

  it('names a missing property as required', () => {
    expect(issuesOf({})).toEqual([{ path: 'orderId', message: 'is required' }]);
  });

  it('names a property the schema does not take', () => {
    expect(issuesOf({ orderId: 'o-1', extra: 1 })).toEqual([
      { path: 'extra', message: 'is not a field the inputs schema takes' },
    ]);
  });

  it('dots nested paths and keeps Ajv’s own reason otherwise', () => {
    expect(issuesOf({ orderId: 'o-1', nested: { amount: 'no' } })).toEqual([
      { path: 'nested.amount', message: 'must be number' },
    ]);
  });

  it('unescapes a JSON-pointer segment', () => {
    expect(issuesOf({ orderId: 'o-1', 'a/b': 7 })).toEqual([
      { path: 'a/b', message: 'must be string' },
    ]);
  });

  it('names the root as the empty path', () => {
    expect(issuesOf('wrong')).toEqual([
      { path: '', message: 'must be object' },
    ]);
    expect(issuesOf(null)).toEqual([{ path: '', message: 'must be object' }]);
  });

  it('lists every problem, capped at twenty', () => {
    const wide = compileSchema({
      type: 'object',
      required: Array.from({ length: 25 }, (_, i) => `f${i}`),
    });
    wide({});
    const issues = describeSchemaErrors(wide.errors);
    expect(issues).toHaveLength(20);
    expect(issues[0]).toEqual({ path: 'f0', message: 'is required' });
  });

  it('answers nothing for no errors', () => {
    expect(describeSchemaErrors(null)).toEqual([]);
    expect(describeSchemaErrors(undefined)).toEqual([]);
  });
});
