import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { blankStringsAsAbsent, blankStringsAsNull } from './blank-strings';

/**
 * The door's one reading of a blank string. The regression under test:
 * on PATCH `""` was a silent no-op on `phone`/`email`, cleared `externalId`
 * and was stored as `""` on `notes` — three answers to one input — and no
 * spelling cleared a field at all (`null` was refused).
 */

const shape = z
  .object({
    name: z.string().trim().min(1, 'must not be blank').optional(),
    phone: z.string().trim().max(50).nullable().optional(),
    source: z.enum(['api_import', 'custom']).optional(),
    address: z.record(z.string(), z.unknown()).nullable().optional(),
    count: z.number().int().optional(),
  })
  .strict();

describe('blankStringsAsNull — the patch composition', () => {
  const patch = blankStringsAsNull(shape);

  it('reads a blank clearable field as null and keeps other values as sent', () => {
    expect(patch.parse({ phone: '   ', address: { city: '' } })).toEqual({
      phone: null,
      address: { city: '' },
    });
    expect(patch.parse({ phone: ' +1 ' })).toEqual({ phone: '+1' });
    expect(patch.parse({ phone: null })).toEqual({ phone: null });
  });

  it('leaves a blank in a field that cannot be cleared to that field’s own rule', () => {
    const name = patch.safeParse({ name: '   ' });
    expect(name.success).toBe(false);
    expect(name.error?.issues[0]).toMatchObject({
      path: ['name'],
      message: 'must not be blank',
    });
    const source = patch.safeParse({ source: '' });
    expect(source.success).toBe(false);
    expect(source.error?.issues[0]?.path).toEqual(['source']);
    const count = patch.safeParse({ count: '' });
    expect(count.success).toBe(false);
    expect(count.error?.issues[0]?.path).toEqual(['count']);
  });

  it('keeps the strict rule and passes a non-object body through to the schema', () => {
    expect(patch.safeParse({ nmae: 'typo' }).success).toBe(false);
    expect(patch.safeParse([]).success).toBe(false);
    expect(patch.safeParse(Symbol('invalid-json')).success).toBe(false);
  });
});

describe('blankStringsAsAbsent — the create composition', () => {
  const create = blankStringsAsAbsent(shape);

  it('drops a blank optional field so the row gets the default', () => {
    const parsed = create.parse({
      phone: '',
      name: ' ',
      address: { city: '' },
    });
    expect(parsed).toEqual({ address: { city: '' } });
    expect(Object.hasOwn(parsed, 'phone')).toBe(false);
    expect(Object.hasOwn(parsed, 'name')).toBe(false);
  });

  it('leaves a blank required field to its own rule', () => {
    const required = blankStringsAsAbsent(
      shape.extend({ name: z.string().trim().min(1, 'must not be blank') }),
    );
    const name = required.safeParse({ name: ' ' });
    expect(name.success).toBe(false);
    expect(name.error?.issues[0]).toMatchObject({
      path: ['name'],
      message: 'must not be blank',
    });
    expect(required.parse({ name: ' Ada ', phone: '' })).toEqual({
      name: 'Ada',
    });
  });

  it('never rewrites a value inside a nested object or array', () => {
    expect(create.parse({ address: { lines: ['', ' '] } })).toEqual({
      address: { lines: ['', ' '] },
    });
  });
});
