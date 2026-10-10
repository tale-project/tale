// @vitest-environment node

import { describe, expect, it } from 'vitest';

import type { ConnectorLike } from '../slots';
import { isClosed, lookup, toTs, UNKNOWN, type Shape } from './shape';
import { connectorOutputShape, parseSignature } from './signature';

function shapeOf(text: string): Shape {
  const parsed = parseSignature(text);
  if ('error' in parsed) throw new Error(parsed.error.message);
  return parsed.shape;
}

describe('parseSignature', () => {
  it('reads object types exactly, with optional members', () => {
    const shape = shapeOf(
      '{ issues: Array<{ number: number, title: string }>, truncated: boolean, nextCursor?: string }',
    );
    expect(toTs(shape)).toBe(
      '{ issues: Array<{ number: number, title: string }>, truncated: boolean, nextCursor?: string }',
    );
    expect(isClosed(shape)).toBe(true);
    expect(lookup(shape, 'cursor')).toMatchObject({
      kind: 'missing',
      closed: true,
    });
    expect(shape['x-origin']).toBe('signature');
  });

  it('reads the forms the catalog writes', () => {
    expect(toTs(shapeOf('string[]'))).toBe('Array<string>');
    expect(toTs(shapeOf('Array<string>[]'))).toBe('Array<Array<string>>');
    expect(toTs(shapeOf('{ since: number | null }'))).toBe(
      '{ since: number | null }',
    );
    expect(toTs(shapeOf('Record<string, Record<string, unknown>>'))).toBe(
      'Record<string, Record<string, unknown>>',
    );
    expect(
      toTs(shapeOf('{ reason?: "already_running" | \'in_review\' }')),
    ).toBe('{ reason?: "already_running" | "in_review" }');
    expect(toTs(shapeOf('{ a: (string | number)[] }'))).toBe(
      '{ a: Array<string | number> }',
    );
    expect(toTs(shapeOf('{ a: string; b: number; }'))).toBe(
      '{ a: string, b: number }',
    );
    expect(toTs(shapeOf('{ "odd-key": true, n: 2 }'))).toBe(
      '{ "odd-key": true, n: 2 }',
    );
  });

  it('reads object as an open bag and unknown/any as unknown', () => {
    const bag = shapeOf('object');
    expect(lookup(bag, 'anything')).toEqual({ kind: 'unknown' });
    expect(shapeOf('unknown')).toBe(UNKNOWN);
    expect(shapeOf('any')).toBe(UNKNOWN);
    expect(toTs(shapeOf('{ x: undefined }'))).toBe('{ x: null }');
  });

  it.each([
    ['{ a: string', 'the object type is not closed'],
    ['{ a string }', 'expected ":" but found "string"'],
    ['Date', 'unknown type name "Date"'],
    ['{ a: string } extra', 'unexpected "extra" after the type'],
    ["{ a: 'open }", 'unterminated string literal'],
    ['{ a: # }', 'unexpected character "#"'],
  ])('refuses %s', (text, message) => {
    expect(parseSignature(text)).toEqual({
      error: { message, offset: expect.any(Number) },
    });
  });

  it('points at the offending token', () => {
    expect(parseSignature('{ a: Date }')).toEqual({
      error: { message: 'unknown type name "Date"', offset: 5 },
    });
  });

  it('refuses nesting deeper than it reads', () => {
    const deep = `${'Array<'.repeat(40)}string${'>'.repeat(40)}`;
    expect(parseSignature(deep)).toMatchObject({
      error: { message: 'the type nests too deeply' },
    });
  });
});

describe('connectorOutputShape', () => {
  const connector = (outputSignature: string): ConnectorLike => ({
    name: 'demo.read',
    description: 'reads',
    inputSchema: {},
    outputSignature,
    hasEffect: false,
    mock: () => ({}),
  });

  it('parses once per definition', () => {
    const def = connector('{ id: string }');
    const first = connectorOutputShape(def);
    expect(connectorOutputShape(def)).toBe(first);
    expect(toTs(first)).toBe('{ id: string }');
  });

  it('is unknown for a signature that does not read', () => {
    expect(connectorOutputShape(connector('{ id: Date }'))).toBe(UNKNOWN);
  });
});
