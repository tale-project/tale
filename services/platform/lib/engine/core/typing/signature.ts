/**
 * Connector output signatures → Shape.
 *
 * Every connector action documents its output as a compact TypeScript type
 * (`{ issues: Array<{ number: number, title: string }>, truncated: boolean
 * }`). This is a recursive-descent reader for the subset the catalog
 * writes:
 *
 *   Type    := Union
 *   Union   := '|'? Postfix ('|' Postfix)*
 *   Postfix := Primary ('[' ']')*
 *   Primary := string | number | boolean | null | undefined | unknown | any
 *            | object | true | false | StringLit | NumberLit
 *            | Array '<' Type '>' | Record '<' Type ',' Type '>'
 *            | '(' Type ')' | '{' (Member (',' | ';')?)* '}'
 *   Member  := (Ident | StringLit) '?'? ':' Type
 *
 * A TS object type lists exactly its keys, so every object read here is
 * exact (`x-origin: 'signature'`); `object` is an open bag, `unknown` and
 * `any` are UNKNOWN, `undefined` is an absent value (null).
 *
 * Connector definitions are the system catalog — the same for every
 * organization — so the parsed shape is cached per definition object, and a
 * re-registered catalog drops its entries with the old objects.
 */

import type { ConnectorLike } from '../slots';
import {
  BOOLEAN_SHAPE,
  NULL_SHAPE,
  NUMBER_SHAPE,
  STRING_SHAPE,
  UNKNOWN,
  union,
  type Shape,
} from './shape';

export type SignatureResult =
  | { shape: Shape }
  | { error: { message: string; offset: number } };

interface Token {
  kind: 'ident' | 'string' | 'number' | 'punct' | 'end';
  text: string;
  /** The decoded value of a string or number literal. */
  value?: string | number;
  offset: number;
}

class SignatureError extends Error {
  constructor(
    message: string,
    public offset: number,
  ) {
    super(message);
  }
}

const PUNCT = new Set([
  '{',
  '}',
  '<',
  '>',
  '[',
  ']',
  '(',
  ')',
  ',',
  ';',
  ':',
  '?',
  '|',
]);
const MAX_NESTING = 32;

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (PUNCT.has(c)) {
      out.push({ kind: 'punct', text: c, offset: i });
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let value = '';
      while (j < text.length && text[j] !== c) {
        if (text[j] === '\\' && j + 1 < text.length) {
          value += text[j + 1];
          j += 2;
        } else {
          value += text[j];
          j++;
        }
      }
      if (j >= text.length) {
        throw new SignatureError('unterminated string literal', i);
      }
      out.push({
        kind: 'string',
        text: text.slice(i, j + 1),
        value,
        offset: i,
      });
      i = j + 1;
      continue;
    }
    const num = /^-?\d+(?:\.\d+)?/.exec(text.slice(i));
    if (num !== null) {
      out.push({
        kind: 'number',
        text: num[0],
        value: Number(num[0]),
        offset: i,
      });
      i += num[0].length;
      continue;
    }
    const ident = /^[A-Za-z_$][\w$]*/.exec(text.slice(i));
    if (ident !== null) {
      out.push({ kind: 'ident', text: ident[0], offset: i });
      i += ident[0].length;
      continue;
    }
    throw new SignatureError(`unexpected character "${c}"`, i);
  }
  out.push({ kind: 'end', text: '', offset: text.length });
  return out;
}

class Reader {
  private pos = 0;
  private nesting = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private next(): Token {
    const t = this.tokens[this.pos];
    if (t.kind !== 'end') this.pos++;
    return t;
  }

  private isPunct(text: string): boolean {
    const t = this.peek();
    return t.kind === 'punct' && t.text === text;
  }

  private expect(text: string): void {
    const t = this.next();
    if (t.kind !== 'punct' || t.text !== text) {
      throw new SignatureError(
        `expected "${text}" but found ${t.kind === 'end' ? 'the end' : `"${t.text}"`}`,
        t.offset,
      );
    }
  }

  document(): Shape {
    const shape = this.type();
    const rest = this.peek();
    if (rest.kind !== 'end') {
      throw new SignatureError(
        `unexpected "${rest.text}" after the type`,
        rest.offset,
      );
    }
    return shape;
  }

  private type(): Shape {
    const t = this.peek();
    if (++this.nesting > MAX_NESTING) {
      throw new SignatureError('the type nests too deeply', t.offset);
    }
    try {
      if (this.isPunct('|')) this.next();
      const members = [this.postfix()];
      while (this.isPunct('|')) {
        this.next();
        members.push(this.postfix());
      }
      return members.length === 1 ? members[0] : union(...members);
    } finally {
      this.nesting--;
    }
  }

  private postfix(): Shape {
    let shape = this.primary();
    while (this.isPunct('[')) {
      this.next();
      this.expect(']');
      shape = { type: 'array', items: shape, 'x-origin': 'signature' };
    }
    return shape;
  }

  private primary(): Shape {
    const t = this.next();
    if (t.kind === 'string') {
      return { type: 'string', const: String(t.value) };
    }
    if (t.kind === 'number') {
      return { type: 'number', const: Number(t.value) };
    }
    if (t.kind === 'punct') {
      if (t.text === '(') {
        const inner = this.type();
        this.expect(')');
        return inner;
      }
      if (t.text === '{') return this.object();
      throw new SignatureError(`unexpected "${t.text}"`, t.offset);
    }
    if (t.kind === 'end') {
      throw new SignatureError('the type ends early', t.offset);
    }
    switch (t.text) {
      case 'string':
        return STRING_SHAPE;
      case 'number':
        return NUMBER_SHAPE;
      case 'boolean':
        return BOOLEAN_SHAPE;
      case 'null':
      case 'undefined':
        return NULL_SHAPE;
      case 'true':
        return { type: 'boolean', const: true };
      case 'false':
        return { type: 'boolean', const: false };
      case 'unknown':
      case 'any':
        return UNKNOWN;
      case 'object':
        return {
          type: 'object',
          additionalProperties: true,
          'x-origin': 'signature',
        };
      case 'Array': {
        this.expect('<');
        const items = this.type();
        this.expect('>');
        return { type: 'array', items, 'x-origin': 'signature' };
      }
      case 'Record': {
        this.expect('<');
        this.type();
        this.expect(',');
        const values = this.type();
        this.expect('>');
        return {
          type: 'object',
          additionalProperties: values,
          'x-origin': 'signature',
        };
      }
      default:
        throw new SignatureError(`unknown type name "${t.text}"`, t.offset);
    }
  }

  private object(): Shape {
    const entries: Array<[string, Shape]> = [];
    const required: string[] = [];
    while (!this.isPunct('}')) {
      const key = this.next();
      if (key.kind !== 'ident' && key.kind !== 'string') {
        throw new SignatureError(
          key.kind === 'end'
            ? 'the object type is not closed'
            : `expected a member name but found "${key.text}"`,
          key.offset,
        );
      }
      const name = key.kind === 'string' ? String(key.value) : key.text;
      let optional = false;
      if (this.isPunct('?')) {
        this.next();
        optional = true;
      }
      this.expect(':');
      entries.push([name, this.type()]);
      if (!optional) required.push(name);
      if (this.isPunct(',') || this.isPunct(';')) this.next();
    }
    this.expect('}');
    const shape: Shape = { type: 'object', 'x-origin': 'signature' };
    if (entries.length > 0) shape.properties = Object.fromEntries(entries);
    if (required.length > 0) shape.required = required;
    return shape;
  }
}

/** Read one TS-style output signature. */
export function parseSignature(text: string): SignatureResult {
  try {
    return { shape: new Reader(tokenize(text)).document() };
  } catch (e) {
    if (e instanceof SignatureError) {
      return { error: { message: e.message, offset: e.offset } };
    }
    throw e;
  }
}

const cache = new WeakMap<ConnectorLike, Shape>();

/** The output shape a connector action documents; UNKNOWN when its
 * signature does not read (the catalog guard test keeps that from
 * shipping). */
export function connectorOutputShape(connector: ConnectorLike): Shape {
  let shape = cache.get(connector);
  if (shape === undefined) {
    const parsed = parseSignature(connector.outputSignature);
    shape = 'shape' in parsed ? parsed.shape : UNKNOWN;
    cache.set(connector, shape);
  }
  return shape;
}
