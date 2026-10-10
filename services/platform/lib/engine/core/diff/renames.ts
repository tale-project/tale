/**
 * Renamed nodes: a node that left the document under one id and came back
 * under another, its body unchanged except for the references that now
 * follow the new names.
 *
 * Two nodes are the same node renamed only when the earlier one, with every
 * reference to a renamed node rewritten to its new id, is exactly the later
 * one (its `id` and `ui` left out). There is no fuzzy matching: a node that
 * was renamed and edited in the same version reads as one removed and one
 * added. References are found through the syntax layer's reference sites —
 * the reads the executors evaluate, in the expression fields `sourcesOf`
 * enumerates — and each id is rewritten at the exact characters the
 * tokenizer finds for it, never by searching the text. A comment or a string
 * that merely mentions `nodes.old` is not a reference and is never rewritten.
 */

import { stableStringify } from '@tale/ui/data/stable-stringify';
import { tokenizer, type Token } from 'acorn';

import { isRecord } from '../../../utils/type-utils';
import { RUNTIME_ECMA_VERSION } from '../syntax/parse';
import { pointerTokens } from '../syntax/pointer';
import {
  newParseCtx,
  outputSources,
  sourcesOf,
  type ExprSource,
  type ParseCtx,
} from '../syntax/sources';
import type { RefSite } from '../syntax/walk';
import type { NodeDef } from '../types';

/** A node as stored: a JSON object, nothing about it assumed. */
export type RawNode = Readonly<Record<string, unknown>>;

/** One node renamed: its id before and after. */
export interface Rename {
  from: string;
  to: string;
}

/** How a reference spells the id it reads: a bare name (`nodes.a`), or the
 * quote of the literal holding it (`nodes['a']`, `nodes[\`a\`]`). */
type Spelling = 'name' | '"' | "'" | '`';

/** One reference whose id was found at exact characters of its text. */
interface PlacedRef {
  id: string;
  start: number;
  end: number;
  spelling: Spelling;
}

/** One expression string of a value, with the node references placed in it. */
interface PlacedSource {
  /** Where the string sits in the value the sources were read from. */
  tokens: readonly string[];
  text: string;
  refs: readonly PlacedRef[];
}

/** A value's references, read once and ready to be rewritten. */
export interface ReferenceIndex {
  /** Every node id the value's expressions (and a node's `elseOf`) read. */
  reads: ReadonlySet<string>;
  sources: readonly PlacedSource[];
  /** Ids read by a reference whose id is not spelled at exact characters
   * (an escape sequence, a parenthesized `nodes`): a rename of one of them
   * cannot be rewritten, so it is never assumed. */
  unplaced: ReadonlySet<string>;
  /** The node a node's `elseOf` names. */
  elseOf?: string;
}

/** The canonical text of a node's body: every field but `id` and `ui`, keys
 * sorted — the same `stableStringify` form the replay planner compares nodes
 * by. */
export function canonicalBody(node: RawNode): string {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key !== 'id' && key !== 'ui') body[key] = value;
  }
  return stableStringify(body);
}

/** The fields of a raw node the syntax layer reads expressions from, at the
 * kinds it reads them as; a field of another kind holds no expression. */
function expressionView(node: RawNode): NodeDef {
  const text = (key: string): string | undefined => {
    const value = node[key];
    return typeof value === 'string' ? value : undefined;
  };
  const view: NodeDef = { id: text('id') ?? '', type: text('type') ?? '' };
  if (isRecord(node.input)) view.input = node.input;
  if (isRecord(node.files)) view.files = node.files;
  for (const key of [
    'prompt',
    'system',
    'code',
    'when',
    'forEach',
    'repeatUntil',
  ] as const) {
    const value = text(key);
    if (value !== undefined) view[key] = value;
  }
  return view;
}

function valueOf(token: Token): unknown {
  // acorn's tokens carry their value at run time; its typings omit it.
  return Reflect.get(token, 'value');
}

/**
 * Where in `text` the id a `nodes` reference reads is spelled: the name after
 * `nodes.` or `nodes?.`, or the characters inside the literal of
 * `nodes['…']`, `nodes["…"]` or nodes[`…`]. Null when those characters are
 * not exactly the id (an escape sequence spells it) or the chain has another
 * shape, so the reference cannot be rewritten exactly.
 */
function placeId(text: string, site: RefSite): PlacedRef | null {
  const id = site.nodeId;
  if (id === undefined || site.dynamicNodeAccess === true) return null;
  const [base, end] = site.range;
  const tokens: Token[] = [];
  try {
    for (const token of tokenizer(text.slice(base, end), {
      ecmaVersion: RUNTIME_ECMA_VERSION,
    })) {
      tokens.push(token);
      if (tokens.length >= 6) break;
    }
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e;
    // The tokens read before the error still spell the chain's start; a
    // chain cut short of its id is refused below.
  }
  const label = (at: number): string | undefined => tokens[at]?.type.label;
  const spelled = (
    token: Token | undefined,
    from: number,
    to: number,
    spelling: Spelling,
  ): PlacedRef | null =>
    token !== undefined &&
    valueOf(token) === id &&
    text.slice(base + from, base + to) === id
      ? { id, start: base + from, end: base + to, spelling }
      : null;
  const named = (token: Token | undefined): PlacedRef | null =>
    token === undefined ? null : spelled(token, token.start, token.end, 'name');

  const root = tokens[0];
  if (root === undefined || valueOf(root) !== 'nodes') return null;
  let at = 1;
  if (label(at) === '.') return named(tokens[at + 1]);
  if (label(at) === '?.') {
    if (label(at + 1) !== '[') return named(tokens[at + 1]);
    at += 1;
  }
  if (label(at) !== '[') return null;
  const literal = tokens[at + 1];
  if (literal === undefined) return null;
  if (label(at + 1) === 'string') {
    const quote = text[base + literal.start];
    if (quote !== '"' && quote !== "'") return null;
    return spelled(literal, literal.start + 1, literal.end - 1, quote);
  }
  const chunk = tokens[at + 2];
  if (
    label(at + 1) === '`' &&
    label(at + 2) === 'template' &&
    label(at + 3) === '`' &&
    chunk !== undefined
  ) {
    return spelled(chunk, chunk.start, chunk.end, '`');
  }
  return null;
}

/** The id as the same spelling writes it; null when that spelling cannot
 * hold it without an escape. */
function spell(id: string, spelling: Spelling): string | null {
  switch (spelling) {
    case 'name':
      return /^[A-Za-z_$][\w$]*$/.test(id) ? id : null;
    case '`':
      return /[`\\]|\$\{/.test(id) ? null : id;
    default:
      return id.includes(spelling) || /[\\\n\r\u2028\u2029]/.test(id)
        ? null
        : id;
  }
}

function indexSources(
  sources: readonly ExprSource[],
  dropTokens: number,
): ReferenceIndex {
  const reads = new Set<string>();
  const unplaced = new Set<string>();
  const placed: PlacedSource[] = [];
  for (const source of sources) {
    const refs: PlacedRef[] = [];
    for (const unit of source.units) {
      for (const site of unit.refs) {
        if (site.root !== 'nodes' || site.nodeId === undefined) continue;
        reads.add(site.nodeId);
        const ref = placeId(source.text, site);
        if (ref === null) unplaced.add(site.nodeId);
        else refs.push(ref);
      }
    }
    if (refs.length > 0) {
      placed.push({
        tokens: pointerTokens(source.pointer).slice(dropTokens),
        text: source.text,
        // From the end, so a rewrite leaves the offsets before it in place.
        refs: refs.toSorted((a, b) => b.start - a.start),
      });
    }
  }
  return { reads, sources: placed, unplaced };
}

/** The references of one node: its expression fields, read through the
 * syntax layer, and the node its `elseOf` names. */
export function nodeReferences(node: RawNode, ctx?: ParseCtx): ReferenceIndex {
  const index = indexSources(
    sourcesOf(expressionView(node), undefined, ctx),
    0,
  );
  const elseOf = node.elseOf;
  if (typeof elseOf !== 'string') return index;
  return { ...index, reads: new Set([...index.reads, elseOf]), elseOf };
}

/** The references of the document's `output`, at pointers relative to the
 * output itself. */
export function outputReferences(
  output: unknown,
  ctx?: ParseCtx,
): ReferenceIndex {
  return indexSources(outputSources(output, ctx), 1);
}

/** `root` with the string at `tokens` replaced; every container on the way
 * is copied, nothing else is. */
function replaceAt(
  root: unknown,
  tokens: readonly string[],
  value: string,
): unknown {
  if (tokens.length === 0) return value;
  const [head, ...rest] = tokens;
  if (Array.isArray(root)) {
    const copy: unknown[] = [...root];
    const at = Number(head);
    copy[at] = replaceAt(copy[at], rest, value);
    return copy;
  }
  if (isRecord(root)) {
    return { ...root, [head]: replaceAt(root[head], rest, value) };
  }
  return root;
}

/**
 * `value` with every reference `index` placed in it to an id in `renames`
 * rewritten to the new id — the expressions only; a node's `elseOf` is
 * {@link rewriteNode}'s. `value` itself when it reads none of them; null
 * when one of them could not be rewritten exactly.
 */
export function rewriteReferences(
  value: unknown,
  index: ReferenceIndex,
  renames: ReadonlyMap<string, string>,
): unknown {
  if ([...index.unplaced].some((id) => renames.has(id))) return null;
  let out = value;
  for (const source of index.sources) {
    if (!source.refs.some((ref) => renames.has(ref.id))) continue;
    let text = source.text;
    for (const ref of source.refs) {
      const to = renames.get(ref.id);
      if (to === undefined) continue;
      const written = spell(to, ref.spelling);
      if (written === null) return null;
      text = text.slice(0, ref.start) + written + text.slice(ref.end);
    }
    out = replaceAt(out, source.tokens, text);
  }
  return out;
}

/** A node with its references to renamed ids rewritten, `elseOf` included;
 * null when one of them could not be rewritten exactly. */
export function rewriteNode(
  node: RawNode,
  index: ReferenceIndex,
  renames: ReadonlyMap<string, string>,
): RawNode | null {
  const rewritten = rewriteReferences(node, index, renames);
  if (!isRecord(rewritten)) return null;
  const to = index.elseOf === undefined ? undefined : renames.get(index.elseOf);
  return to === undefined ? rewritten : { ...rewritten, elseOf: to };
}

/** The renames a value reads — in one top-level field of it when `field` is
 * given — sorted by their old id. */
export function renamesRead(
  index: ReferenceIndex,
  renames: ReadonlyMap<string, string>,
  field?: string,
): Rename[] {
  const ids = new Set<string>();
  if (field === undefined) {
    for (const id of index.reads) ids.add(id);
  } else if (field === 'elseOf') {
    if (index.elseOf !== undefined) ids.add(index.elseOf);
  } else {
    for (const source of index.sources) {
      if (source.tokens[0] !== field) continue;
      for (const ref of source.refs) ids.add(ref.id);
    }
  }
  return [...ids]
    .filter((id) => renames.has(id))
    .toSorted()
    .map((from) => ({ from, to: renames.get(from) ?? from }));
}

/** A node's body with the id of every reference it places replaced by one
 * mark, so two bodies that differ only in the ids they read share a key. */
function shapeKey(node: RawNode, index: ReferenceIndex): string {
  let masked: unknown = node;
  for (const source of index.sources) {
    let text = source.text;
    for (const ref of source.refs) {
      text = `${text.slice(0, ref.start)}\u0000${text.slice(ref.end)}`;
    }
    masked = replaceAt(masked, source.tokens, text);
  }
  if (!isRecord(masked)) return canonicalBody(node);
  return canonicalBody(
    index.elseOf === undefined ? masked : { ...masked, elseOf: '\u0000' },
  );
}

/** The most pairings rename detection tries for one diff; past it, the
 * nodes it has not paired read as removed and added. */
export const MAX_RENAME_TRIALS = 2_000;

/** A node only one of the two documents has. */
export interface UnpairedNode {
  id: string;
  node: RawNode;
}

/**
 * Pair the nodes only `before` has with the nodes only `after` has that are
 * the same node renamed; the answer maps each old id to its new one.
 *
 * Each removed node is tried, in `before`'s order, against the added nodes
 * of the same shape, in `after`'s order, and the first that matches is
 * taken. A node that reads another renamed node matches only once that
 * rename is known, so a node is tried again whenever a node it reads is
 * paired. Deterministic for the same two lists.
 */
export function findRenames(
  removed: readonly UnpairedNode[],
  added: readonly UnpairedNode[],
  ctx: ParseCtx = newParseCtx(),
): Map<string, string> {
  const renames = new Map<string, string>();
  if (removed.length === 0 || added.length === 0) return renames;

  const shapes = new Map<string, UnpairedNode[]>();
  const canonicalAfter = new Map<string, string>();
  for (const entry of added) {
    const key = shapeKey(entry.node, nodeReferences(entry.node, ctx));
    shapes.set(key, [...(shapes.get(key) ?? []), entry]);
    canonicalAfter.set(entry.id, canonicalBody(entry.node));
  }
  const prepared = new Map<
    string,
    { entry: UnpairedNode; index: ReferenceIndex; key: string }
  >();
  const readers = new Map<string, string[]>();
  for (const entry of removed) {
    const index = nodeReferences(entry.node, ctx);
    prepared.set(entry.id, { entry, index, key: shapeKey(entry.node, index) });
    for (const id of index.reads) {
      readers.set(id, [...(readers.get(id) ?? []), entry.id]);
    }
  }

  const taken = new Set<string>();
  const pending = removed.map((entry) => entry.id);
  const queued = new Set(pending);
  let trials = 0;
  for (let next = pending.shift(); next !== undefined; next = pending.shift()) {
    queued.delete(next);
    const known = prepared.get(next);
    if (known === undefined || renames.has(next)) continue;
    for (const candidate of shapes.get(known.key) ?? []) {
      if (taken.has(candidate.id)) continue;
      if (trials >= MAX_RENAME_TRIALS) return renames;
      trials += 1;
      const trial = new Map(renames).set(next, candidate.id);
      const rewritten = rewriteNode(known.entry.node, known.index, trial);
      if (
        rewritten === null ||
        canonicalBody(rewritten) !== canonicalAfter.get(candidate.id)
      ) {
        continue;
      }
      renames.set(next, candidate.id);
      taken.add(candidate.id);
      for (const reader of readers.get(next) ?? []) {
        if (renames.has(reader) || queued.has(reader)) continue;
        pending.push(reader);
        queued.add(reader);
      }
      break;
    }
  }
  return renames;
}
