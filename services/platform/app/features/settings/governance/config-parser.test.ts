import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createConfigParser } from './config-parser';

const schema = z.object({
  enabled: z.boolean(),
  count: z.number().default(0),
});

describe('createConfigParser', () => {
  it('returns the parsed config when the input is valid', () => {
    const parse = createConfigParser(schema, () => ({
      enabled: false,
      count: 0,
    }));
    expect(parse({ enabled: true, count: 5 })).toEqual({
      enabled: true,
      count: 5,
    });
  });

  it('falls back when the input is not an object', () => {
    const parse = createConfigParser(schema, () => ({
      enabled: false,
      count: 0,
    }));
    expect(parse(null)).toEqual({ enabled: false, count: 0 });
    expect(parse('nope')).toEqual({ enabled: false, count: 0 });
    expect(parse(undefined)).toEqual({ enabled: false, count: 0 });
  });

  it('falls back when the input is an object that fails validation', () => {
    const parse = createConfigParser(schema, () => ({
      enabled: false,
      count: 0,
    }));
    // `enabled` is required and missing → safeParse fails → fallback.
    expect(parse({ count: 3 })).toEqual({ enabled: false, count: 0 });
  });

  it('invokes the factory fallback fresh each call (no shared mutable default)', () => {
    const parse = createConfigParser(schema, () => ({
      enabled: false,
      count: 0,
    }));
    const a = parse(null);
    const b = parse(null);
    expect(a).toEqual({ enabled: false, count: 0 });
    expect(a).not.toBe(b);
  });
});
