import { describe, expect, it } from 'vitest';
import { z } from 'zod';

/**
 * The four behaviours `patches/zod@4.6.6.patch` keeps as Zod had them
 * before 4.4 and 4.5, on plain schemas. Every door, the CLI and the MCP
 * endpoint build on them; patches/README.md says why each is kept and when
 * it goes.
 */
describe('zod as Tale patches it', () => {
  it('measures a string cap in UTF-16 code units, where an emoji counts 2', () => {
    const cap = z.string().max(4);
    expect(cap.safeParse('🎯🎯').success).toBe(true);
    expect(cap.safeParse('🎯🎯🎯').success).toBe(false);
    expect(z.string().min(2).safeParse('🎯').success).toBe(true);
    expect(z.string().length(2).safeParse('🎯').success).toBe(true);
  });

  it("leaves a check's issue to the parse call's map, not the schema's own", () => {
    const limit = z.int({ error: 'must be a whole number' }).min(1);
    const phrase = (value: unknown) =>
      limit.safeParse(value, {
        error: (issue) =>
          issue.code === 'too_small' ? 'must be at least 1' : undefined,
      }).error?.issues[0]?.message;
    expect(phrase(1.5)).toBe('must be a whole number');
    expect(phrase(0)).toBe('must be at least 1');
  });

  it('lets an object leave out a key whose schema takes undefined', async () => {
    const row = z.object({ id: z.string(), error: z.unknown() });
    expect(row.safeParse({ id: 'm1' }).data).toEqual({ id: 'm1' });
    expect((await row.safeParseAsync({ id: 'm1' })).data).toEqual({ id: 'm1' });
    expect(Object.keys(row.parse({ id: 'm1' }))).toEqual(['id']);
    const note = z.object({ note: z.string().or(z.undefined()) });
    expect(note.safeParse({}).success).toBe(true);
    expect(note.safeParse({ note: 1 }).success).toBe(false);
  });

  it('renders a nullable field as anyOf, not as a type array', () => {
    const rendered = z.toJSONSchema(z.object({ name: z.string().nullable() }), {
      target: 'draft-2020-12',
    });
    expect(rendered.properties?.name).toEqual({
      anyOf: [{ type: 'string' }, { type: 'null' }],
    });
  });
});
