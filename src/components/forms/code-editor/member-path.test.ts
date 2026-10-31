import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import type { CodeLanguage } from '../../../lib/code-roles';
import { languageExtension } from './extensions/languages';
import { cursorContext, hoverContext } from './member-path';

/** A state for `text`, with `|` marking the cursor. */
function at(text: string, language: CodeLanguage, templates = false) {
  const pos = text.indexOf('|');
  const doc = text.replace('|', '');
  const state = EditorState.create({
    doc,
    extensions: [languageExtension(language, templates)],
  });
  return { state, pos };
}

function context(text: string, language: CodeLanguage, templates = false) {
  const { state, pos } = at(text, language, templates);
  return cursorContext(state, pos);
}

describe('cursorContext in code', () => {
  it('reads the chain before a word being typed after a dot', () => {
    const found = context('return nodes.score.output.it|', 'javascript');
    expect(found).toMatchObject({
      region: 'code',
      path: ['nodes', 'score', 'output'],
      word: 'it',
      trigger: 'dot',
    });
  });

  it('reads quoted keys, optional chaining and indexes', () => {
    expect(context('nodes["a b"]?.x.|', 'expression').path).toEqual([
      'nodes',
      'a b',
      'x',
    ]);
    expect(context('input.items[0].|', 'expression').path).toEqual([
      'input',
      'items',
      0,
    ]);
    expect(context('nodes?.["a b"].|', 'expression').path).toEqual([
      'nodes',
      'a b',
    ]);
  });

  it('answers an empty chain for a bare name', () => {
    expect(context('inp|', 'expression')).toMatchObject({
      path: [],
      word: 'inp',
      trigger: 'name',
    });
  });

  it('reads the chain before a bracket', () => {
    expect(context('nodes[|', 'expression')).toMatchObject({
      path: ['nodes'],
      trigger: 'bracket',
    });
  });

  it('gives no chain in a comment or a string', () => {
    expect(context('// nodes.|', 'javascript')).toMatchObject({
      region: 'comment',
      path: null,
    });
    expect(context('const a = "nodes.|";', 'javascript')).toMatchObject({
      region: 'string',
      path: null,
    });
  });

  it('reads the JavaScript inside a template', () => {
    expect(context('Hi {{ input.na| }}', 'template')).toMatchObject({
      region: 'template',
      path: ['input'],
      word: 'na',
    });
    expect(context('{"to": "{{ nodes.a.| }}"}', 'json', true)).toMatchObject({
      region: 'template',
      path: ['nodes', 'a'],
    });
  });

  it('gives no chain in the text around a template', () => {
    expect(context('Hi th|ere {{ a }}', 'template')).toMatchObject({
      region: 'text',
      path: null,
    });
  });
});

describe('cursorContext in JSON and YAML', () => {
  it('names a key and the pointer of the object it belongs to', () => {
    expect(context('{"a": {"b|": 1}}', 'json')).toMatchObject({
      region: 'key',
      pointer: '/a',
    });
  });

  it('names a value and its own pointer', () => {
    expect(context('{"a": [1, {"to": "x|"}]}', 'json')).toMatchObject({
      region: 'string',
      pointer: '/a/1/to',
    });
    expect(
      context('nodes:\n  - id: a\n    prompt: Hi th|ere', 'yaml'),
    ).toMatchObject({ region: 'string', pointer: '/nodes/0/prompt' });
  });
});

describe('hoverContext', () => {
  it('reads the whole word and the chain up to it', () => {
    const { state, pos } = at('nodes.sc|ore.output', 'expression');
    expect(hoverContext(state, pos, 1)).toMatchObject({
      word: 'score',
      path: ['nodes', 'score'],
    });
  });

  it('answers nothing outside a name', () => {
    const { state, pos } = at('1 +| 2', 'expression');
    expect(hoverContext(state, pos, 1)).toBeNull();
  });
});
