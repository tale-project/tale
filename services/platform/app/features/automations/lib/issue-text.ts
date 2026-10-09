/**
 * How a validation issue reads to a person, in the session's language.
 *
 * The engine names every issue by a stable `code` and gives the facts its
 * sentence is built from as `params` (`lib/engine/core/errors.ts`,
 * `CODE_META`). Its `message` and `hint` stay English: they are the public,
 * golden-tested API agents read. A person reads the `automationIssues`
 * catalog instead — for each code a short title, a plain explanation, the
 * concrete cause and the fix — interpolated with the params this module
 * prepares: node ids become the names the canvas shows, field names the
 * labels the inspector shows, lists one locale-formatted list, types the
 * words for their kind ("a number", "text"). A code this build does not
 * know (a newer server) still reads as words: a generic title and
 * explanation, with the engine's own English left to the technical details.
 */

import { CODE_META, CODES, type IssueCode } from '@/lib/engine/core/errors';
import { PARSE_LIMIT_MESSAGE } from '@/lib/engine/core/syntax/parse';
import type { Issue, IssueParamValue } from '@/lib/engine/core/types';

import { humanizeNodeId } from './node-label';

/** An issue as the engine and the API send it. */
export type WireIssue = Issue;

/** The four sentences a person reads for one issue. */
export interface IssueText {
  /** Short, the same for every issue of its code. */
  title: string;
  /** What the code means, the same for every issue of its code. */
  explanation: string;
  /** This issue's concrete case. */
  cause: string;
  /** What to do about it. */
  fix: string;
  /** False for a code this build has no text for: then `cause` and `fix`
   * are empty, and only the generic title and explanation are words — the
   * engine's English message and hint belong to the technical details. */
  known: boolean;
}

/** The translate function of the session's language. Every key this module
 * reads names its namespace, so any bound `t` will do. */
export type IssueTranslate = (
  key: string,
  options?: Record<string, unknown>,
) => string;

export interface IssueTextContext {
  locale: string;
  t: IssueTranslate;
}

type TextValues = Record<string, string | number>;

/** At most this many entries of a list are named; the rest are counted. */
const LIST_LIMIT = 6;

/** Params that name a node by its id; each becomes `<param>Label`. */
const NODE_ID_PARAMS: ReadonlySet<string> = new Set([
  'node',
  'partner',
  'via',
  'failing',
  'a',
  'b',
  'target',
  'childNode',
  'source',
]);

/** Codes where a param of another meaning elsewhere names a node too. */
const NODE_ID_PARAMS_BY_CODE: Partial<Record<IssueCode, readonly string[]>> = {
  OUTPUT_MAYBE_EMPTY: ['root'],
};

/** Params that hold a list; each becomes `<param>List` and `<param>Count`. */
const LIST_PARAMS: ReadonlySet<string> = new Set([
  'allowed',
  'available',
  'cycle',
  'declared',
  'keys',
  'known',
  'missing',
  'names',
  'nodes',
  'possible',
  'unknown',
]);

/** List params whose entries are node ids, named the way the canvas does. */
const NODE_LIST_PARAMS: ReadonlySet<string> = new Set(['cycle', 'nodes']);

/** Zero-based positions, shown counted from one. */
const POSITION_PARAMS: Readonly<Record<string, string>> = {
  index: 'position',
  firstIndex: 'firstPosition',
  test: 'testNumber',
};

/**
 * Params a catalog sentence selects on. ICU select keys cannot hold a `-`,
 * so their kebab-case values arrive camel-cased (`not-a-template` →
 * `notATemplate`).
 */
const SELECT_PARAMS: Partial<Record<IssueCode, readonly string[]>> = {
  NODE_FIELD_TYPE: ['expected'],
  ELSEOF_TARGET_INVALID: ['reason'],
  REF_UNKNOWN_FIELD: ['root'],
  TYPE_MISMATCH: ['consumer'],
  TEMPLATE_NULL_INTERPOLATION: ['why'],
  FOREACH_NOT_ARRAY: ['reason'],
  UNREACHABLE: ['cause'],
  CONDITION_CONSTANT: ['cause'],
  OUTPUT_MAYBE_EMPTY: ['rootReason'],
  UNUSED_NODE: ['reason'],
};

/** Params derived beyond the ones a code's meta lists. */
const EXTRA_DERIVED: Partial<Record<IssueCode, readonly string[]>> = {
  REF_UNKNOWN_FIELD: ['sourceLabel'],
  UNCAUGHT_FAILURE: ['failingIsSource'],
  TYPE_MISMATCH: ['expectedText', 'actualText'],
  TESTS_EXPECT_TYPE: ['expectedText', 'actualText'],
};

function isIssueCode(code: string): code is IssueCode {
  return Object.hasOwn(CODES, code);
}

function paramName(declared: string): string {
  return declared.endsWith('?') ? declared.slice(0, -1) : declared;
}

function nodeIdParamsOf(code: IssueCode): ReadonlySet<string> {
  const extra = NODE_ID_PARAMS_BY_CODE[code];
  return extra === undefined
    ? NODE_ID_PARAMS
    : new Set([...NODE_ID_PARAMS, ...extra]);
}

function derivedParamsOf(code: IssueCode): readonly string[] {
  const meta = CODE_META[code];
  const technical = new Set(meta.technical ?? []);
  const nodeIds = nodeIdParamsOf(code);
  const derived: string[] =
    code === 'CODE_SYNTAX' || code === 'EXPR_SYNTAX' ? ['parseLimited'] : [];
  for (const declared of meta.params) {
    const name = paramName(declared);
    if (technical.has(name)) continue;
    if (nodeIds.has(name)) derived.push(`${name}Label`);
    if (LIST_PARAMS.has(name)) derived.push(`${name}List`, `${name}Count`);
    const position = POSITION_PARAMS[name];
    if (position !== undefined) derived.push(position);
    if (name === 'field') derived.push('fieldLabel', 'place');
    if (name === 'reasons') derived.push('reasonText');
    if (name === 'automation') derived.push('automationLabel');
  }
  for (const name of EXTRA_DERIVED[code] ?? []) {
    if (!derived.includes(name)) derived.push(name);
  }
  return derived;
}

/**
 * The params each code's `cause` and `fix` may use beside its own
 * `CODE_META` params: names prepared for reading. `nodeLabel` and every
 * other `…Label` is a node's name the way the canvas shows it (or a field's
 * label the way the inspector shows it), already in the language's quotes;
 * `…List` a quoted, locale-formatted list naming at most six entries, with
 * `…Count` its full length; `position`, `firstPosition` and `testNumber`
 * count from one; `place` opens a sentence with where the issue is
 * ("In "Prompt" of "fetch orders""); `reasonText` says when a node is
 * skipped.
 */
export const ISSUE_DERIVED_PARAMS: Readonly<
  Record<IssueCode, readonly string[]>
> =
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- one entry per key of CODE_META, which the mapped type makes exactly the codes
  Object.fromEntries(
    Object.keys(CODE_META)
      .filter(isIssueCode)
      .map((code) => [code, derivedParamsOf(code)]),
  ) as Record<IssueCode, readonly string[]>;

/** Every key of this module's catalog names its namespace here. */
function say(t: IssueTranslate, key: string, values: TextValues = {}): string {
  return t(key, { ...values, ns: 'automationIssues' });
}

/** `text` in the language's quotes. */
export function quote(t: IssueTranslate, text: string): string {
  return say(t, 'quote', { text });
}

/** A node's name the way the canvas shows it, in the language's quotes. */
export function nodeLabel(t: IssueTranslate, id: string): string {
  return quote(t, humanizeNodeId(id));
}

/** A field's label the way the inspector shows it; the field as written
 * when it has no label. */
export function fieldName(t: IssueTranslate, field: string): string {
  return t(`editor.fields.${field}`, {
    ns: 'automations',
    defaultValue: field,
  });
}

/** {@link fieldName} in the language's quotes. */
export function fieldLabel(t: IssueTranslate, field: string): string {
  return quote(t, fieldName(t, field));
}

function listOf(
  ctx: IssueTextContext,
  entries: readonly string[],
  type: 'conjunction' | 'disjunction' = 'conjunction',
): string {
  const shown = entries.slice(0, LIST_LIMIT);
  const rest = entries.length - shown.length;
  const items =
    rest > 0 ? [...shown, say(ctx.t, 'more', { count: rest })] : shown;
  return new Intl.ListFormat(ctx.locale, { type }).format(items);
}

function camelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_, letter: string) =>
    letter.toUpperCase(),
  );
}

function stringList(value: IssueParamValue | undefined): readonly string[] {
  return Array.isArray(value) ? value : [];
}

function asText(value: IssueParamValue | undefined): string | undefined {
  if (typeof value === 'string') return value === '' ? undefined : value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

/** The kinds of value the catalog names in words (`kinds.<kind>`). */
type ValueKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'undefined'
  | 'array'
  | 'object'
  | 'other';

const VALUE_KINDS: ReadonlySet<string> = new Set<ValueKind>([
  'string',
  'number',
  'boolean',
  'null',
  'undefined',
  'array',
  'object',
]);

/** A kind of value (`kindOf`'s word) as the catalog names it: "a number",
 * "text", "a list". */
export function kindLabel(t: IssueTranslate, kind: string): string {
  return say(t, `kinds.${VALUE_KINDS.has(kind) ? kind : 'other'}`);
}

/** `a | b` split where the `|` is not inside brackets or quotes. */
function unionParts(type: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let open: string | null = null;
  let start = 0;
  for (let i = 0; i < type.length; i++) {
    const ch = type[i];
    if (open !== null) {
      if (ch === '\\') i++;
      else if (ch === open) open = null;
    } else if (ch === '"' || ch === "'") open = ch;
    else if (ch === '<' || ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '>' || ch === '}' || ch === ']' || ch === ')') depth--;
    else if (ch === '|' && depth === 0) {
      parts.push(type.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(type.slice(start).trim());
  return parts.filter((part) => part !== '');
}

function kindOfType(part: string): ValueKind {
  if (part === 'string' || /^["'`]/.test(part)) return 'string';
  if (part === 'number' || /^-?\d/.test(part)) return 'number';
  if (part === 'boolean' || part === 'true' || part === 'false') {
    return 'boolean';
  }
  if (part === 'null' || part === 'undefined') return part;
  if (part === 'array' || part.startsWith('Array<') || part.endsWith('[]')) {
    return 'array';
  }
  if (part.startsWith('[')) return 'array';
  if (part === 'object' || part.startsWith('{') || part.startsWith('Record<')) {
    return 'object';
  }
  return 'other';
}

/**
 * A type as the engine writes it (`string | null`, `Array<number>`,
 * `{ items: Array<number> }`) in words: the kinds of value it allows, as the
 * catalog names them, joined with "or". The exact shape stays in the
 * technical details.
 */
function typeText(ctx: IssueTextContext, type: string | undefined): string {
  const kinds = [...new Set(unionParts(type ?? '').map(kindOfType))];
  if (kinds.length === 0) return say(ctx.t, 'kinds.other');
  return listOf(
    ctx,
    kinds.map((kind) => say(ctx.t, `kinds.${kind}`)),
    'disjunction',
  );
}

/** When a node is skipped, from the reasons a flow finding lists. */
function reasonText(
  ctx: IssueTextContext,
  reasons: readonly string[],
  values: TextValues,
): string {
  const phrases = reasons.flatMap((reason) =>
    reason === 'when' ||
    reason === 'else' ||
    reason === 'upstream' ||
    reason === 'error'
      ? [say(ctx.t, `reasons.${reason}`, values)]
      : [],
  );
  return phrases.length === 0
    ? say(ctx.t, 'reasons.sometimes')
    : listOf(ctx, phrases, 'disjunction');
}

/** What {@link sourceLabel} names for a reference's root. */
function referenceSource(
  ctx: IssueTextContext,
  params: Issue['params'],
): string {
  const root = params?.root;
  if (root === 'nodes' && typeof params?.source === 'string') {
    return say(ctx.t, 'sources.node', {
      nodeLabel: nodeLabel(ctx.t, params.source),
    });
  }
  if (root === 'input') {
    return say(
      ctx.t,
      params?.field === 'code' ? 'sources.ownInput' : 'sources.input',
    );
  }
  if (root === 'item') return say(ctx.t, 'sources.item');
  if (root === 'output') return say(ctx.t, 'sources.passOutput');
  return say(ctx.t, 'sources.data');
}

/**
 * The values a catalog sentence interpolates: the issue's params, made
 * selectable and readable, plus the derived params
 * ({@link ISSUE_DERIVED_PARAMS}). An optional param the issue leaves out
 * reads `none`, so a sentence can `select` on its presence; technical
 * params (raw parser or schema-validator English) are left out entirely.
 */
export function issueParamsForText(
  issue: WireIssue,
  ctx: IssueTextContext,
): TextValues {
  const code = issue.code;
  if (!isIssueCode(code)) return {};
  const meta = CODE_META[code];
  const params = issue.params ?? {};
  const technical = new Set(meta.technical ?? []);
  const selects = new Set(SELECT_PARAMS[code] ?? []);
  const nodeIds = nodeIdParamsOf(code);
  const values: TextValues = {};
  if (code === 'CODE_SYNTAX' || code === 'EXPR_SYNTAX') {
    values.parseLimited = String(params.detail === PARSE_LIMIT_MESSAGE);
  }

  for (const declared of meta.params) {
    const name = paramName(declared);
    if (technical.has(name)) continue;
    const value = params[name];

    if (LIST_PARAMS.has(name)) {
      const entries = stringList(value);
      values[`${name}Count`] = entries.length;
      values[`${name}List`] =
        name === 'cycle'
          ? entries.map((id) => nodeLabel(ctx.t, id)).join(' → ')
          : listOf(
              ctx,
              entries.map((entry) =>
                NODE_LIST_PARAMS.has(name)
                  ? nodeLabel(ctx.t, entry)
                  : quote(ctx.t, entry),
              ),
            );
      continue;
    }
    if (name === 'reasons') continue;

    const text = asText(value);
    values[name] =
      typeof value === 'number'
        ? value
        : text === undefined
          ? 'none'
          : selects.has(name)
            ? camelCase(text)
            : text;

    if (nodeIds.has(name)) {
      values[`${name}Label`] =
        text === undefined ? 'none' : nodeLabel(ctx.t, text);
    }
    const position = POSITION_PARAMS[name];
    if (position !== undefined) {
      values[position] = typeof value === 'number' ? value + 1 : 'none';
    }
    if (name === 'automation') {
      values.automationLabel = text === undefined ? 'none' : quote(ctx.t, text);
    }
  }

  const field = asText(params.field);
  if (meta.params.some((p) => paramName(p) === 'field')) {
    const node = asText(params.node);
    values.fieldLabel = field === undefined ? 'none' : fieldLabel(ctx.t, field);
    values.place = say(ctx.t, 'place', {
      hasNode: node === undefined ? 'false' : 'true',
      field: field ?? 'none',
      fieldLabel: values.fieldLabel,
      nodeLabel: node === undefined ? 'none' : nodeLabel(ctx.t, node),
    });
  }
  if (meta.params.includes('reasons')) {
    values.reasonText = reasonText(ctx, stringList(params.reasons), values);
  }
  if (code === 'REF_UNKNOWN_FIELD') {
    values.sourceLabel = referenceSource(ctx, params);
  }
  if (code === 'UNCAUGHT_FAILURE') {
    values.failingIsSource = String(params.failing === params.source);
  }
  if (code === 'TYPE_MISMATCH' || code === 'TESTS_EXPECT_TYPE') {
    values.expectedText = typeText(ctx, asText(params.expected));
    values.actualText = typeText(ctx, asText(params.actual));
  }
  return values;
}

/** Title, explanation, cause and fix of one issue, in `ctx`'s language. */
export function issueText(issue: WireIssue, ctx: IssueTextContext): IssueText {
  const code = issue.code;
  if (!isIssueCode(code)) {
    return {
      title: say(ctx.t, 'unknownCode.title'),
      explanation: say(ctx.t, 'unknownCode.explanation'),
      cause: '',
      fix: '',
      known: false,
    };
  }
  const values = issueParamsForText(issue, ctx);
  return {
    title: say(ctx.t, `codes.${code}.title`),
    explanation: say(ctx.t, `codes.${code}.explanation`),
    cause: say(ctx.t, `codes.${code}.cause`, values),
    fix: say(ctx.t, `codes.${code}.fix`, values),
    known: true,
  };
}

/** The level's word: "Error" or "Warning". */
export function issueLevelLabel(
  level: WireIssue['level'],
  t: IssueTranslate,
): string {
  return say(t, level === 'error' ? 'levels.error' : 'levels.warning');
}
