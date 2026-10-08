// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  parentPointer,
  pointerFromAjv,
  pointerTokens,
  ptr,
  resolvePointer,
} from './pointer';

describe('JSON Pointers (RFC 6901)', () => {
  it('escapes "~" and "/" inside a token', () => {
    expect(ptr('nodes', 0, 'input', 'a/b', 'c~d')).toBe(
      '/nodes/0/input/a~1b/c~0d',
    );
    expect(pointerTokens('/nodes/0/input/a~1b/c~0d')).toEqual([
      'nodes',
      '0',
      'input',
      'a/b',
      'c~d',
    ]);
  });

  it('resolves into a document, or says it does not', () => {
    const doc = { nodes: [{ input: { 'a/b': 1 } }] };
    expect(resolvePointer(doc, '/nodes/0/input/a~1b')).toEqual({
      found: true,
      value: 1,
    });
    expect(resolvePointer(doc, '')).toEqual({ found: true, value: doc });
    expect(resolvePointer(doc, '/nodes/1')).toEqual({ found: false });
    expect(resolvePointer(doc, '/nodes/01')).toEqual({ found: false });
    expect(resolvePointer(doc, '/nodes/0/input/a~1b/x')).toEqual({
      found: false,
    });
  });

  it('appends an Ajv instance path verbatim and climbs to a parent', () => {
    expect(pointerFromAjv('/nodes/2/input', '/units')).toBe(
      '/nodes/2/input/units',
    );
    expect(parentPointer('/nodes/2/input')).toBe('/nodes/2');
    expect(parentPointer('/nodes')).toBe('');
    expect(parentPointer('')).toBeNull();
  });
});
