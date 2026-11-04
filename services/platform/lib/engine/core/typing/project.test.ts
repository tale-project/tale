// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { openPlacesOf, projectOntoShape } from './project';
import { union, UNKNOWN, type Shape } from './shape';
import { parseSignature } from './signature';

function shapeOf(text: string): Shape {
  const parsed = parseSignature(text);
  if ('error' in parsed) throw new Error(parsed.error.message);
  return parsed.shape;
}

function project(signature: string, value: unknown): unknown {
  return projectOntoShape(value, shapeOf(signature));
}

describe('projectOntoShape', () => {
  it('keeps only the members an object type lists, at every depth', () => {
    expect(
      project(
        '{ issues: Array<{ number: number, user: { login: string } }>, truncated: boolean }',
        {
          issues: [
            {
              number: 7,
              user: { login: 'mia', email: 'mia@example.com' },
              temp_clone_token: 'secret',
            },
          ],
          truncated: false,
          rate: { remaining: 4999 },
        },
      ),
    ).toEqual({
      issues: [{ number: 7, user: { login: 'mia' } }],
      truncated: false,
    });
  });

  it('projects every value of a Record onto its value type', () => {
    expect(
      project('Record<string, { id: string }>', {
        a: { id: '1', token: 'x' },
        b: { id: '2' },
      }),
    ).toEqual({ a: { id: '1' }, b: { id: '2' } });
  });

  it('hands object, unknown and any on as they are', () => {
    const vendor = { id: 1, nested: { anything: ['goes'] } };
    expect(project('{ raw: object }', { raw: vendor })).toEqual({
      raw: vendor,
    });
    expect(project('{ raw: unknown }', { raw: vendor })).toEqual({
      raw: vendor,
    });
    expect(project('any', vendor)).toBe(vendor);
    expect(projectOntoShape(vendor, UNKNOWN)).toBe(vendor);
    expect(project('Array<object>', [vendor])).toEqual([vendor]);
  });

  it('keeps a member of a union only where some branch declares it', () => {
    const signature =
      '{ result: { ok: true, id: string } | { ok: false, error: string } }';
    expect(
      project(signature, { result: { ok: true, id: 'a', secret: 's' } }),
    ).toEqual({ result: { ok: true, id: 'a' } });
    // Both object branches admit an object, so either one's members survive.
    expect(
      project(signature, { result: { ok: false, error: 'e', id: 'b', x: 1 } }),
    ).toEqual({ result: { ok: false, error: 'e', id: 'b' } });
  });

  it('projects a member onto every branch that declares it', () => {
    expect(
      project('{ a: { m: { x: string } } } | { a: { m: { y: string } } }', {
        a: { m: { x: '1', y: '2', z: '3' } },
      }),
    ).toEqual({ a: { m: { x: '1', y: '2' } } });
  });

  it('takes only the union branches of the value’s kind', () => {
    const signature =
      '{ items: Array<{ id: string }> | { id: string } | null }';
    expect(project(signature, { items: null })).toEqual({ items: null });
    expect(project(signature, { items: [{ id: '1', extra: 2 }] })).toEqual({
      items: [{ id: '1' }],
    });
    expect(project(signature, { items: { id: '1', extra: 2 } })).toEqual({
      items: { id: '1' },
    });
  });

  it('hands the value on when an open branch admits it', () => {
    expect(
      project('{ v: { id: string } | object }', { v: { id: '1', more: 2 } }),
    ).toEqual({ v: { id: '1', more: 2 } });
    expect(project('{ v: string | unknown }', { v: { more: 2 } })).toEqual({
      v: { more: 2 },
    });
  });

  it('keeps no member of an object no branch admits', () => {
    expect(
      project('{ name: string }', { name: { first: 'Mia', token: 't' } }),
    ).toEqual({ name: {} });
    expect(
      project('{ ids: string[] }', { ids: [{ token: 't' }, 'a'] }),
    ).toEqual({ ids: [{}, 'a'] });
    expect(project('{}', { anything: 1 })).toEqual({});
  });

  it('passes strings, numbers, booleans and null unchanged', () => {
    expect(project('{ id: string }', 'text')).toBe('text');
    expect(project('{ id: string }', 3)).toBe(3);
    expect(project('{ id: string }', null)).toBeNull();
    expect(project('{ n: number }', { n: 'not a number' })).toEqual({
      n: 'not a number',
    });
  });

  it('reads a member by its own name only', () => {
    const value = JSON.parse(
      '{ "id": "1", "__proto__": { "polluted": true }, "constructor": "c" }',
    ) as object;
    const projected = project('{ id: string }', value) as Record<
      string,
      unknown
    >;
    expect(projected).toEqual({ id: '1' });
    expect(Object.getPrototypeOf(projected)).toBe(Object.prototype);
    expect(Object.hasOwn(projected, 'constructor')).toBe(false);
  });

  it('keeps a declared __proto__ member as data', () => {
    const value = JSON.parse('{ "__proto__": { "a": 1 } }') as object;
    const projected = project(
      '{ "__proto__": { a: number } }',
      value,
    ) as object;
    expect(Object.getPrototypeOf(projected)).toBe(Object.prototype);
    expect(
      Object.getOwnPropertyDescriptor(projected, '__proto__')?.value,
    ).toEqual({ a: 1 });
  });

  it('is not capped by the width of a union', () => {
    const branches = Array.from({ length: 14 }, (_, i) =>
      shapeOf(`{ kind: "k${i}", v${i}: string }`),
    );
    // `union()` turns more than 12 members into UNKNOWN; the projection
    // reads the branches it is given, so a wide union still cuts.
    expect(union(...branches)).toBe(UNKNOWN);
    const shape: Shape = { anyOf: branches };
    expect(
      projectOntoShape({ kind: 'k3', v3: 'a', secret: 's' }, shape),
    ).toEqual({ kind: 'k3', v3: 'a' });
  });

  it('never edits the value it is given', () => {
    const value = { a: { b: 1, c: 2 }, list: [{ d: 1, e: 2 }] };
    const before = structuredClone(value);
    project('{ a: { b: number }, list: Array<{ d: number }> }', value);
    expect(value).toEqual(before);
  });
});

describe('openPlacesOf', () => {
  it('names every place the projection hands on whole', () => {
    expect(
      openPlacesOf(
        shapeOf(
          '{ id: string, raw: object, note: unknown, list: Array<{ meta: any, ok: boolean }>, byName: Record<string, object>, pick: { id: string } | object }',
        ),
      ),
    ).toEqual(['$.raw', '$.note', '$.list[].meta', '$.byName{}', '$.pick']);
  });

  it('names nothing in a signature that lists every member', () => {
    expect(
      openPlacesOf(
        shapeOf(
          '{ id: string, list: Array<{ n: number }>, byName: Record<string, { id: string }>, r: { ok: true } | { ok: false, error: string } | null }',
        ),
      ),
    ).toEqual([]);
  });

  it('names the whole output when the signature is open', () => {
    expect(openPlacesOf(UNKNOWN)).toEqual(['$']);
    expect(openPlacesOf(shapeOf('object'))).toEqual(['$']);
    expect(openPlacesOf(shapeOf('Array<object>'))).toEqual(['$[]']);
  });
});
