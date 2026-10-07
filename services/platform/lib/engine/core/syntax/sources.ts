/**
 * The ONE enumeration of every expression an automation document holds.
 *
 * Execution order (`refsOf` → `topoSort`, used by both executors), the
 * canvas edges, scope pruning and every validation rule read the document's
 * code through this list, so a reference the graph sees is exactly the one
 * the validator checks and the runtime evaluates.
 *
 * Fields, as the executors evaluate them:
 *  - DATA fields — a skipped source node skips this node too: every string
 *    nested in `input` and `files`, the `prompt`/`system` templates, the
 *    `forEach` template and the transform `code` body;
 *  - CONTROL fields — they order the two nodes and nothing else: the `when`
 *    and `repeatUntil` conditions (one bare expression when they hold no
 *    `{{`, templates otherwise);
 *  - the document `output`, whose nested strings are templates.
 *
 * `elseOf` names a node rather than holding an expression; `refsOf` adds it
 * as an ordering edge.
 */

import type { NodeDef } from '../types';
import { scopeNamesFor, type SourceField } from './globals';
import { parseBody, parseExpressionIn, type ParseResult } from './parse';
import { ptr } from './pointer';
import {
  conditionKind,
  exprSegments,
  tokenizeTemplate,
  type Tokenized,
} from './tokens';
import { collectRefs, looseNodeRefs, type RefSite } from './walk';

export type { SourceField } from './globals';

/** One expression (or one transform body) inside a source string. */
export interface ExprUnit {
  /** [start, end) of the code in the source string, whitespace-trimmed. */
  range: [number, number];
  source: string;
  parse: ParseResult;
  /**
   * Its references. When the code does not parse, the node references a
   * token scan still finds — enough to keep the graph's edges while a draft
   * is being typed, never enough for a finding.
   */
  refs: RefSite[];
  /** Set by validation when the runner compiles code acorn rejects: the
   * code is valid, but no analysis runs on it. */
  opaque?: true;
}

export interface ExprSource {
  nodeId?: string;
  nodeIndex?: number;
  field: SourceField;
  /** RFC 6901 pointer of the STRING holding the code, e.g.
   * `/nodes/2/input/to` or `/output/summary`. */
  pointer: string;
  kind: 'template' | 'condition' | 'body';
  text: string;
  /** Templates and non-bare conditions. */
  tokens?: Tokenized;
  units: ExprUnit[];
  /** A skip of a referenced node propagates through this field. */
  data: boolean;
}

/**
 * A per-call parse memo. Identical text in identical scope parses once; the
 * memo lives as long as one validation call, so no document content outlives
 * the request that brought it.
 */
export interface ParseCtx {
  cache: Map<string, { tokens?: Tokenized; units: ExprUnit[] }>;
}

export function newParseCtx(): ParseCtx {
  return { cache: new Map() };
}

const DATA_FIELDS: ReadonlySet<SourceField> = new Set([
  'input',
  'prompt',
  'system',
  'files',
  'code',
  'forEach',
]);

function unitOf(
  text: string,
  start: number,
  end: number,
  roots: ReadonlySet<string>,
): ExprUnit {
  const parse = parseExpressionIn(text, start, end);
  return {
    range: [start, end],
    source: text.slice(start, end),
    parse,
    refs: parse.ok
      ? collectRefs(parse.ast, { roots })
      : looseNodeRefs(text, start, end),
  };
}

function templateUnits(
  text: string,
  roots: ReadonlySet<string>,
): { tokens: Tokenized; units: ExprUnit[] } {
  const tokens = tokenizeTemplate(text);
  const units = exprSegments(tokens).map((s) =>
    unitOf(text, s.exprStart ?? s.start, s.exprEnd ?? s.end, roots),
  );
  return { tokens, units };
}

function analyzeText(
  kind: ExprSource['kind'],
  text: string,
  roots: ReadonlySet<string>,
  ctx: ParseCtx | undefined,
): { tokens?: Tokenized; units: ExprUnit[] } {
  const key =
    ctx === undefined
      ? undefined
      : `${kind}\u0000${[...roots].join(',')}\u0000${text}`;
  const hit = key === undefined ? undefined : ctx?.cache.get(key);
  if (hit !== undefined) return hit;
  let out: { tokens?: Tokenized; units: ExprUnit[] };
  if (kind === 'body') {
    const parse = parseBody(text);
    out = {
      units: [
        {
          range: [0, text.length],
          source: text,
          parse,
          refs: parse.ok
            ? collectRefs(parse.ast, { roots })
            : looseNodeRefs(text, 0, text.length),
        },
      ],
    };
  } else if (kind === 'condition' && conditionKind(text) === 'bare') {
    const lead = text.length - text.trimStart().length;
    const trail = text.length - text.trimEnd().length;
    const start = Math.min(lead, text.length - trail);
    out = { units: [unitOf(text, start, text.length - trail, roots)] };
  } else {
    out = templateUnits(text, roots);
  }
  if (key !== undefined) ctx?.cache.set(key, out);
  return out;
}

/** Visit every string nested in a value, with its pointer. */
function walkStrings(
  value: unknown,
  pointer: string,
  fn: (s: string, pointer: string) => void,
): void {
  if (typeof value === 'string') fn(value, pointer);
  else if (Array.isArray(value)) {
    for (const [i, v] of value.entries())
      walkStrings(v, `${pointer}${ptr(i)}`, fn);
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      walkStrings(v, `${pointer}${ptr(k)}`, fn);
    }
  }
}

/**
 * Every expression source of one node, in a fixed reading order: input,
 * prompt, system, files, code, when, forEach, repeatUntil. With an `index`
 * the pointers are document pointers (`/nodes/<index>/…`); without one they
 * are relative to the node.
 */
export function sourcesOf(
  node: NodeDef,
  index?: number,
  ctx?: ParseCtx,
): ExprSource[] {
  const base = index === undefined ? '' : ptr('nodes', index);
  const out: ExprSource[] = [];
  const id = typeof node.id === 'string' ? node.id : undefined;
  const push = (
    field: SourceField,
    kind: ExprSource['kind'],
    text: string,
    pointer: string,
  ): void => {
    const { tokens, units } = analyzeText(
      kind,
      text,
      scopeNamesFor(field, node),
      ctx,
    );
    out.push({
      ...(id !== undefined && { nodeId: id }),
      ...(index !== undefined && { nodeIndex: index }),
      field,
      pointer,
      kind,
      text,
      ...(tokens !== undefined && { tokens }),
      units,
      data: DATA_FIELDS.has(field),
    });
  };
  const templates = (field: SourceField, value: unknown): void => {
    walkStrings(value, `${base}${ptr(field)}`, (s, pointer) => {
      if (s.includes('{{')) push(field, 'template', s, pointer);
    });
  };

  templates('input', node.input);
  templates('prompt', node.prompt);
  templates('system', node.system);
  templates('files', node.files);
  if (typeof node.code === 'string') {
    push('code', 'body', node.code, `${base}${ptr('code')}`);
  }
  if (typeof node.when === 'string') {
    push('when', 'condition', node.when, `${base}${ptr('when')}`);
  }
  templates(
    'forEach',
    typeof node.forEach === 'string' ? node.forEach : undefined,
  );
  if (typeof node.repeatUntil === 'string') {
    push(
      'repeatUntil',
      'condition',
      node.repeatUntil,
      `${base}${ptr('repeatUntil')}`,
    );
  }
  return out;
}

/** The template sources of the document `output`. */
export function outputSources(output: unknown, ctx?: ParseCtx): ExprSource[] {
  const out: ExprSource[] = [];
  const roots = scopeNamesFor('output');
  walkStrings(output, ptr('output'), (text, pointer) => {
    if (!text.includes('{{')) return;
    const { tokens, units } = analyzeText('template', text, roots, ctx);
    out.push({
      field: 'output',
      pointer,
      kind: 'template',
      text,
      ...(tokens !== undefined && { tokens }),
      units,
      data: false,
    });
  });
  return out;
}

/** Every reference site of a node with the source it sits in — what the
 * canvas reads to label an edge with the field and expression behind it. */
export function refSitesOf(
  node: NodeDef,
  index?: number,
): Array<{ source: ExprSource; unit: ExprUnit; site: RefSite }> {
  const out: Array<{ source: ExprSource; unit: ExprUnit; site: RefSite }> = [];
  for (const source of sourcesOf(node, index)) {
    for (const unit of source.units) {
      for (const site of unit.refs) out.push({ source, unit, site });
    }
  }
  return out;
}
