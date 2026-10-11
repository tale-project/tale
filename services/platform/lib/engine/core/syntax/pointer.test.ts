// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  parentPointer,
  pointerFromAjv,
  pointerTokens,
  ptr,
  replaceAtPointer,
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

  it('replaces only a value the document already holds', () => {
    const doc = { nodes: [{ input: { to: ['someone'], 'a/b': 1 } }] };
    expect(replaceAtPointer(doc, '/nodes/0/input/to', ['u1'])).toBe(true);
    expect(replaceAtPointer(doc, '/nodes/0/input/a~1b', 2)).toBe(true);
    expect(replaceAtPointer(doc, '/nodes/0/input/to/0', 'u2')).toBe(true);
    expect(doc).toEqual({ nodes: [{ input: { to: ['u2'], 'a/b': 2 } }] });
    // A pointer never grows the document.
    expect(replaceAtPointer(doc, '/nodes/0/input/title', 'x')).toBe(false);
    expect(replaceAtPointer(doc, '/nodes/1/input', {})).toBe(false);
    expect(replaceAtPointer(doc, '/nodes/0/input/to/1', 'x')).toBe(false);
    expect(replaceAtPointer(doc, '/nodes/0/input/to/-', 'x')).toBe(false);
    expect(replaceAtPointer(doc, '', {})).toBe(false);
    expect(doc).toEqual({ nodes: [{ input: { to: ['u2'], 'a/b': 2 } }] });
  });
});
