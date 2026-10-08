/**
 * JSON Pointer → text offsets: where a problem a check reported by pointer
 * (`/nodes/2/input/to`) sits in the JSON or YAML text a reader edits.
 *
 * A pointer names a value; `subject` picks what to mark:
 *
 * - `value` (default) — the value. With `range`, offsets into the DECODED
 *   string value (what the check saw) are mapped onto the raw text, escapes
 *   and block-scalar indentation included.
 * - `key` — the member's key.
 * - `missing` — the pointer names a member that is not there; mark the key
 *   of the object that should hold it (or that object, at the top level).
 *
 * Both return `null` when the text does not parse or the pointer names
 * nothing; the caller then marks the whole field.
 */

import {
  isMap,
  isNode,
  isPair,
  isScalar,
  isSeq,
  parseDocument,
  type Node as YamlNode,
  type Pair,
  type Scalar,
} from 'yaml';

export type LocateSubject = 'value' | 'key' | 'missing';

export interface LocateOptions {
  /** `[from, to)` inside the decoded string value (subject `value` only). */
  range?: readonly [number, number];
  subject?: LocateSubject;
}

export interface LocatedRange {
  from: number;
  to: number;
}

/** `/a~1b/0` → `['a/b', '0']`; `''` → `[]` (the whole document). */
export function parsePointer(pointer: string): string[] | null {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) return null;
  return pointer
    .slice(1)
    .split('/')
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
}

/* ------------------------------------------------------------------ JSON */

interface JsonString {
  kind: 'string';
  from: number;
  to: number;
  value: string;
  /** Raw offset of each decoded UTF-16 unit, plus one past the last. */
  map: number[];
}

interface JsonMember {
  key: JsonString;
  value: JsonValue;
}

type JsonValue =
  | JsonString
  | { kind: 'object'; from: number; to: number; members: JsonMember[] }
  | { kind: 'array'; from: number; to: number; items: JsonValue[] }
  | { kind: 'scalar'; from: number; to: number };

class JsonReader {
  private pos = 0;

  constructor(private readonly text: string) {}

  read(): JsonValue | null {
    try {
      const value = this.value();
      this.space();
      return this.pos === this.text.length ? value : null;
    } catch (error) {
      if (error instanceof SyntaxError) return null;
      throw error;
    }
  }

  private fail(): never {
    throw new SyntaxError(`Unexpected JSON at ${this.pos}`);
  }

  private space(): void {
    while (/[ \t\n\r]/.test(this.text[this.pos] ?? '')) this.pos++;
  }

  private value(): JsonValue {
    this.space();
    const c = this.text[this.pos];
    if (c === '{') return this.object();
    if (c === '[') return this.array();
    if (c === '"') return this.string();
    const literal =
      /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(
        this.text.slice(this.pos),
      );
    if (literal === null) this.fail();
    const from = this.pos;
    this.pos += literal[0].length;
    return { kind: 'scalar', from, to: this.pos };
  }

  private object(): JsonValue {
    const from = this.pos++;
    const members: JsonMember[] = [];
    this.space();
    if (this.text[this.pos] === '}') {
      this.pos++;
      return { kind: 'object', from, to: this.pos, members };
    }
    for (;;) {
      this.space();
      if (this.text[this.pos] !== '"') this.fail();
      const key = this.string();
      this.space();
      if (this.text[this.pos++] !== ':') this.fail();
      members.push({ key, value: this.value() });
      this.space();
      const next = this.text[this.pos++];
      if (next === '}') return { kind: 'object', from, to: this.pos, members };
      if (next !== ',') this.fail();
    }
  }

  private array(): JsonValue {
    const from = this.pos++;
    const items: JsonValue[] = [];
    this.space();
    if (this.text[this.pos] === ']') {
      this.pos++;
      return { kind: 'array', from, to: this.pos, items };
    }
    for (;;) {
      items.push(this.value());
      this.space();
      const next = this.text[this.pos++];
      if (next === ']') return { kind: 'array', from, to: this.pos, items };
      if (next !== ',') this.fail();
    }
  }

  private string(): JsonString {
    const from = this.pos++;
    let value = '';
    const map: number[] = [];
    for (;;) {
      const at = this.pos;
      const c = this.text[this.pos];
      if (c === undefined || c === '\n') this.fail();
      if (c === '"') {
        this.pos++;
        map.push(at);
        return { kind: 'string', from, to: this.pos, value, map };
      }
      if (c !== '\\') {
        value += c;
        map.push(at);
        this.pos++;
        continue;
      }
      const escape = this.text[this.pos + 1];
      if (escape === 'u') {
        const hex = this.text.slice(this.pos + 2, this.pos + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail();
        value += String.fromCharCode(parseInt(hex, 16));
        map.push(at);
        this.pos += 6;
        continue;
      }
      const decoded = SIMPLE_ESCAPES[escape ?? ''];
      if (decoded === undefined) this.fail();
      value += decoded;
      map.push(at);
      this.pos += 2;
    }
  }
}

const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

function jsonChild(
  value: JsonValue,
  segment: string,
): JsonMember | JsonValue | null {
  if (value.kind === 'object') {
    // The last of duplicate keys wins, as in JSON.parse.
    return (
      value.members.findLast((member) => member.key.value === segment) ?? null
    );
  }
  if (value.kind === 'array' && /^(?:0|[1-9]\d*)$/.test(segment)) {
    return value.items[Number(segment)] ?? null;
  }
  return null;
}

function stringRange(
  value: JsonString,
  range: readonly [number, number] | undefined,
): LocatedRange {
  if (range === undefined) return { from: value.from, to: value.to };
  const length = value.map.length - 1;
  const start = Math.min(Math.max(range[0], 0), length);
  const end = Math.min(Math.max(range[1], start), length);
  if (start === end) return { from: value.map[start], to: value.map[start] };
  // The end is the raw offset after the last decoded unit in the range.
  return { from: value.map[start], to: value.map[end] };
}

export function locateJsonPointer(
  text: string,
  pointer: string,
  options: LocateOptions = {},
): LocatedRange | null {
  const path = parsePointer(pointer);
  if (path === null) return null;
  const root = new JsonReader(text).read();
  if (root === null) return null;
  const subject = options.subject ?? 'value';
  const target = subject === 'missing' ? path.slice(0, -1) : path;
  let value: JsonValue = root;
  let member: JsonMember | null = null;
  for (const segment of target) {
    const child = jsonChild(value, segment);
    if (child === null) return null;
    if ('key' in child) {
      member = child;
      value = child.value;
    } else {
      member = null;
      value = child;
    }
  }
  if (subject === 'missing') {
    if (member !== null) return { from: member.key.from, to: member.key.to };
    return { from: value.from, to: value.from + 1 };
  }
  if (subject === 'key') {
    if (member === null) return null;
    return { from: member.key.from, to: member.key.to };
  }
  if (value.kind === 'string') return stringRange(value, options.range);
  return { from: value.from, to: value.to };
}

/* ------------------------------------------------------------------ YAML */

function yamlKeyText(pair: Pair): string | null {
  const key = pair.key;
  if (isScalar(key)) return String(key.value);
  return null;
}

/**
 * The raw offset of each decoded character of a scalar's value, plus one
 * past the last, by walking the source beside the value: indentation,
 * folded line breaks and quotes are skipped. `null` when the two cannot be
 * aligned (an escape sequence changed a character).
 */
function alignScalar(text: string, scalar: Scalar): number[] | null {
  const value = scalar.value;
  if (typeof value !== 'string' || !scalar.range) return null;
  let [from] = scalar.range;
  const end = scalar.range[1];
  const type = scalar.type;
  if (type === 'QUOTE_DOUBLE') {
    if (text.slice(from, end).includes('\\')) return null;
    from += 1;
  } else if (type === 'QUOTE_SINGLE') {
    from += 1;
  } else if (type === 'BLOCK_LITERAL' || type === 'BLOCK_FOLDED') {
    // Skip the header line (`|`, `>-`, `|2+` and a comment).
    const newline = text.indexOf('\n', from);
    if (newline === -1) return null;
    from = newline + 1;
  }
  const map: number[] = [];
  let j = from;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    while (j < end && text[j] !== c) {
      const skip = text[j];
      if (c === ' ' && skip === '\n') break; // a folded line break
      if (skip !== ' ' && skip !== '\t' && skip !== '\n' && skip !== '\r') {
        return null;
      }
      j++;
    }
    if (j >= end) return null;
    map.push(j);
    j++;
    if (type === 'QUOTE_SINGLE' && c === "'" && text[j] === "'") j++;
  }
  map.push(Math.min(j, end));
  return map;
}

function yamlValueRange(
  text: string,
  node: YamlNode,
  range: readonly [number, number] | undefined,
): LocatedRange | null {
  if (node.range === undefined || node.range === null) return null;
  const whole = { from: node.range[0], to: node.range[1] };
  if (range === undefined || !isScalar(node)) return trimEnd(text, whole);
  const map = alignScalar(text, node);
  if (map === null) return trimEnd(text, whole);
  const length = map.length - 1;
  const start = Math.min(Math.max(range[0], 0), length);
  const stop = Math.min(Math.max(range[1], start), length);
  if (start === stop) return { from: map[start], to: map[start] };
  return { from: map[start], to: map[stop - 1] + 1 };
}

/** A block value's range runs through its last line break; mark the text. */
function trimEnd(text: string, range: LocatedRange): LocatedRange {
  let to = range.to;
  while (to > range.from && /\s/.test(text[to - 1] ?? '')) to--;
  return { from: range.from, to };
}

export function locateYamlPointer(
  text: string,
  pointer: string,
  options: LocateOptions = {},
): LocatedRange | null {
  const path = parsePointer(pointer);
  if (path === null) return null;
  let document;
  try {
    document = parseDocument(text, { keepSourceTokens: false });
  } catch (error) {
    if (error instanceof Error) return null;
    throw error;
  }
  if (document.errors.length > 0 || document.contents === null) return null;
  const subject = options.subject ?? 'value';
  const target = subject === 'missing' ? path.slice(0, -1) : path;
  let node: YamlNode = document.contents;
  let pair: Pair | null = null;
  for (const segment of target) {
    if (isMap(node)) {
      const found: Pair | undefined = node.items.findLast(
        (item) => isPair(item) && yamlKeyText(item) === segment,
      );
      if (found === undefined || !isNode(found.value)) return null;
      pair = found;
      node = found.value;
      continue;
    }
    if (isSeq(node) && /^(?:0|[1-9]\d*)$/.test(segment)) {
      const item: unknown = node.items[Number(segment)];
      if (!isNode(item)) return null;
      pair = null;
      node = item;
      continue;
    }
    return null;
  }
  const keyRange = (): LocatedRange | null => {
    const key = pair?.key;
    if (key === null || key === undefined || !isScalar(key)) return null;
    if (key.range === undefined || key.range === null) return null;
    return { from: key.range[0], to: key.range[1] };
  };
  if (subject === 'missing') {
    if (pair !== null) return keyRange();
    // A sequence item has no key: its first key stands in. The document
    // itself has none either, so the caller marks the whole field.
    if (target.length === 0 || !isMap(node)) return null;
    const first = node.items[0]?.key;
    if (!isScalar(first) || !first.range) return null;
    return { from: first.range[0], to: first.range[1] };
  }
  if (subject === 'key') return keyRange();
  return yamlValueRange(text, node, options.range);
}
