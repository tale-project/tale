import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';

import type { CodePathSegment, CodeRegion } from './providers';

/**
 * Where the cursor is, in the terms a completion or hover provider needs:
 * what kind of text it sits in, the member chain left of the word under it
 * (`nodes["a b"]?.x.it|` → `['nodes', 'a b', 'x']`, word `it`), and for
 * JSON or YAML the pointer of the object around it. Read from the syntax
 * tree, the JavaScript inside a `{{ }}` template included.
 */
export interface CursorContext {
  region: CodeRegion;
  /** The chain before the word; `[]` for a bare name; `null` outside code. */
  path: CodePathSegment[] | null;
  /** The word at the cursor, `[from, to)`; for completion it ends at the cursor. */
  from: number;
  to: number;
  word: string;
  /** What opened completion: a name, a `.`/`?.` or a `[`. */
  trigger: 'name' | 'dot' | 'bracket' | 'none';
  /**
   * JSON/YAML: in a key, the pointer of the object the key belongs to; in a
   * value, the pointer of that value.
   */
  pointer?: string;
}

const JS_TOPS = new Set(['Script', 'SingleExpression']);
const JS_STRINGS = new Set(['String', 'TemplateString', 'RegExp']);
const JS_COMMENTS = new Set(['LineComment', 'BlockComment']);
const NAME = /[\w$]/;

function ancestors(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let at: SyntaxNode | null = node; at !== null; at = at.parent)
    out.push(at);
  return out;
}

function text(state: EditorState, node: SyntaxNode): string {
  return state.doc.sliceString(node.from, node.to);
}

/** A JSON or JavaScript string literal's value, or null. */
function stringValue(raw: string): string | null {
  const quoted = raw.startsWith("'")
    ? `"${raw.slice(1, -1).replaceAll('"', '\\"')}"`
    : raw;
  try {
    const value: unknown = JSON.parse(quoted);
    return typeof value === 'string' ? value : null;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

/** The member chain a node spells, or null when it is not a plain chain. */
function chainOf(
  state: EditorState,
  node: SyntaxNode,
): CodePathSegment[] | null {
  if (node.name === 'VariableName') return [text(state, node)];
  if (node.name === 'ParenthesizedExpression') {
    const inner = node.firstChild?.nextSibling;
    return inner ? chainOf(state, inner) : null;
  }
  if (node.name !== 'MemberExpression') return null;
  const object = node.firstChild;
  if (object === null) return null;
  const base = chainOf(state, object);
  if (base === null) return null;
  let access = object.nextSibling;
  // `a?.["x"]`: the optional marker, then the bracket.
  if (access?.name === '?.' && access.nextSibling?.name === '[') {
    access = access.nextSibling;
  }
  const key = access?.nextSibling;
  if (
    access === null ||
    access === undefined ||
    key === null ||
    key === undefined
  ) {
    return null;
  }
  if (access.name === '.' || access.name === '?.') {
    return key.name === 'PropertyName' ? [...base, text(state, key)] : null;
  }
  if (access.name === '[') {
    if (key.name === 'Number') return [...base, Number(text(state, key))];
    if (key.name === 'String') {
      const value = stringValue(text(state, key));
      return value === null ? null : [...base, value];
    }
  }
  return null;
}

/** The outermost chain node that ends exactly at `end`. */
function chainEndingAt(node: SyntaxNode, end: number): SyntaxNode {
  let at = node;
  while (
    at.parent !== null &&
    at.parent.to === end &&
    (at.parent.name === 'MemberExpression' ||
      at.parent.name === 'ParenthesizedExpression')
  ) {
    at = at.parent;
  }
  return at;
}

function toPointer(segments: readonly string[]): string {
  return segments
    .map((segment) => `/${segment.replaceAll('~', '~0').replaceAll('/', '~1')}`)
    .join('');
}

function jsonPointer(state: EditorState, node: SyntaxNode): string {
  const segments: string[] = [];
  let child: SyntaxNode = node;
  for (let at = node.parent; at !== null; child = at, at = at.parent) {
    if (at.name === 'Property' && child.name !== 'PropertyName') {
      const name = at.getChild('PropertyName');
      const key = name === null ? null : stringValue(text(state, name));
      if (key !== null) segments.unshift(key);
    } else if (at.name === 'Array') {
      let index = 0;
      for (
        let item = at.firstChild;
        item !== null && item.from < child.from;
        item = item.nextSibling
      ) {
        if (!['[', ']', ','].includes(item.name)) index++;
      }
      segments.unshift(String(index));
    }
  }
  return toPointer(segments);
}

function yamlPointer(state: EditorState, node: SyntaxNode): string {
  const segments: string[] = [];
  let child: SyntaxNode = node;
  for (let at = node.parent; at !== null; child = at, at = at.parent) {
    if (at.name === 'Pair' && child.name !== 'Key') {
      const key = at.getChild('Key');
      if (key !== null)
        segments.unshift(text(state, key).replace(/^["']|["']$/g, ''));
    } else if (at.name === 'Item') {
      const list = at.parent;
      if (list === null) continue;
      let index = 0;
      for (
        let item = list.firstChild;
        item !== null && item.from < at.from;
        item = item.nextSibling
      ) {
        if (item.name === 'Item') index++;
      }
      segments.unshift(String(index));
    }
  }
  return toPointer(segments);
}

/** The context at `pos`, for completion: the word runs up to the cursor. */
export function cursorContext(state: EditorState, pos: number): CursorContext {
  const doc = state.doc;
  let from = pos;
  while (from > 0 && NAME.test(doc.sliceString(from - 1, from))) from--;
  const word = doc.sliceString(from, pos);
  const node = syntaxTree(state).resolveInner(pos, -1);
  const chain = ancestors(node);
  const names = new Set(chain.map((at) => at.name));
  const base = { from, to: pos, word };

  // The JavaScript part of the chain: up to its top (a script, or the
  // expression of a template's body), not the JSON or YAML around it.
  const jsTop = chain.findIndex((at) => JS_TOPS.has(at.name));
  if (jsTop !== -1) {
    const inJs = chain.slice(0, jsTop + 1);
    if (inJs.some((at) => JS_COMMENTS.has(at.name))) {
      return { ...base, region: 'comment', path: null, trigger: 'none' };
    }
    const inString = inJs.find((at) => JS_STRINGS.has(at.name));
    if (inString !== undefined && inString.from < pos && inString.to > pos) {
      return { ...base, region: 'string', path: null, trigger: 'none' };
    }
    const region: CodeRegion =
      names.has('TemplateBody') || names.has('Template') ? 'template' : 'code';
    const before = doc.sliceString(Math.max(0, from - 2), from);
    if (before.endsWith('.')) {
      const objectEnd = before.endsWith('?.') ? from - 2 : from - 1;
      const object = chainEndingAt(
        syntaxTree(state).resolveInner(objectEnd, -1),
        objectEnd,
      );
      return { ...base, region, path: chainOf(state, object), trigger: 'dot' };
    }
    if (before.endsWith('[')) {
      const objectEnd = from - 1;
      const object = chainEndingAt(
        syntaxTree(state).resolveInner(objectEnd, -1),
        objectEnd,
      );
      return {
        ...base,
        region,
        path: chainOf(state, object),
        trigger: 'bracket',
      };
    }
    return {
      ...base,
      region,
      path: [],
      trigger: word === '' ? 'none' : 'name',
    };
  }

  if (names.has('JsonText')) {
    const pointer = jsonPointer(state, node);
    if (names.has('PropertyName'))
      return { ...base, region: 'key', path: null, trigger: 'name', pointer };
    if (names.has('String'))
      return {
        ...base,
        region: 'string',
        path: null,
        trigger: 'none',
        pointer,
      };
    return { ...base, region: 'key', path: null, trigger: 'none', pointer };
  }

  if (names.has('Stream')) {
    if (names.has('Key')) {
      return {
        ...base,
        region: 'key',
        path: null,
        trigger: 'name',
        pointer: yamlPointer(state, node),
      };
    }
    if (
      names.has('Literal') ||
      names.has('QuotedLiteral') ||
      names.has('BlockLiteralContent')
    ) {
      return {
        ...base,
        region: 'string',
        path: null,
        trigger: 'none',
        pointer: yamlPointer(state, node),
      };
    }
  }

  return { ...base, region: 'text', path: null, trigger: 'none' };
}

/**
 * The context of the word under `pos`, for hover: the whole word, and the
 * chain up to and including it (`nodes.score.output` on `output`).
 */
export function hoverContext(
  state: EditorState,
  pos: number,
  side: -1 | 1,
): CursorContext | null {
  const node = syntaxTree(state).resolveInner(pos, side);
  if (node.name !== 'VariableName' && node.name !== 'PropertyName') return null;
  const context = cursorContext(state, node.to);
  if (context.region !== 'code' && context.region !== 'template') return null;
  const parent = node.parent;
  const owner =
    node.name === 'PropertyName' && parent?.name === 'MemberExpression'
      ? parent
      : node;
  return {
    ...context,
    from: node.from,
    to: node.to,
    word: text(state, node),
    path: chainOf(state, owner),
    trigger: 'none',
  };
}
