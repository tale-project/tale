/**
 * Tool calls: which offered tool the mock calls, and with what arguments.
 *
 * Arguments are generated from the tool's JSON Schema the way a model fills
 * them: every required property, some optional ones, enums from their
 * values, numbers small and inside their bounds, and strings shaped by the
 * property's name — a `query` carries the user's own keywords, a `url` an
 * address under example.com, an `id` an opaque identifier. The result always
 * parses and always carries the schema's required keys.
 */

import {
  chance,
  clamp,
  pick,
  randomId,
  randomInt,
  type Random,
} from './random.ts';

export interface OfferedTool {
  readonly name: string;
  readonly parameters: Record<string, unknown>;
}

/** What argument strings may draw on. */
export interface ArgumentHints {
  /** Distinctive words of the user's message, for queries and names. */
  readonly keywords: readonly string[];
  readonly locale: string;
}

/** Share of optional properties a generated call fills in. */
const OPTIONAL_SHARE = 0.35;
/** Nesting depth past which objects and arrays stay empty. */
const MAX_DEPTH = 4;

const FALLBACK_TERMS = [
  'quarterly report',
  'onboarding checklist',
  'travel policy',
  'invoice status',
  'project roadmap',
  'support contract',
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The schema's type, the first non-null one when it lists several. */
function schemaType(schema: Record<string, unknown>): string | undefined {
  const type = schema.type;
  if (typeof type === 'string') return type;
  if (Array.isArray(type)) {
    const first = type.find(
      (entry): entry is string => typeof entry === 'string' && entry !== 'null',
    );
    if (first !== undefined) return first;
  }
  if (asRecord(schema.properties)) return 'object';
  if (schema.items !== undefined) return 'array';
  return undefined;
}

function terms(random: Random, hints: ArgumentHints, max: number): string {
  if (hints.keywords.length === 0) return pick(random, FALLBACK_TERMS);
  const count = randomInt(random, 1, Math.min(max, hints.keywords.length));
  return hints.keywords.slice(0, count).join(' ').toLowerCase();
}

function slug(random: Random, hints: ArgumentHints): string {
  return terms(random, hints, 3)
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function uuid(random: Random): string {
  const hex = (length: number): string => {
    let out = '';
    for (let i = 0; i < length; i++) {
      out += Math.floor(random() * 16).toString(16);
    }
    return out;
  };
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
}

function stringFor(
  random: Random,
  name: string,
  schema: Record<string, unknown>,
  hints: ArgumentHints,
): string {
  const key = name.toLowerCase();
  const format = typeof schema.format === 'string' ? schema.format : '';
  let value: string;
  if (format === 'uri' || format === 'url' || /url|uri|link|href/.test(key)) {
    value = `https://example.com/${slug(random, hints) || 'page'}`;
  } else if (format === 'email' || /e-?mail/.test(key)) {
    value = `${slug(random, hints).split('-')[0] || 'someone'}@example.com`;
  } else if (format === 'date-time') {
    value = new Date(Date.UTC(2026, randomInt(random, 0, 11), 1)).toISOString();
  } else if (format === 'date' || /date|day/.test(key)) {
    value = `2026-${String(randomInt(random, 1, 12)).padStart(2, '0')}-${String(randomInt(random, 1, 28)).padStart(2, '0')}`;
  } else if (format === 'uuid' || /uuid/.test(key)) {
    value = uuid(random);
  } else if (/query|search|^q$|keyword|question|prompt|topic|term/.test(key)) {
    value = terms(random, hints, 4);
  } else if (/(^|_)ref$|ref$/.test(key)) {
    value = `doc_${randomId(random, 16)}`;
  } else if (/(^id$|id$|_id$|ids?$)/.test(key)) {
    value = randomId(random, 20);
  } else if (/cursor|token|page/.test(key)) {
    value = randomId(random, 24);
  } else if (/lang|locale/.test(key)) {
    value = hints.locale;
  } else if (/path|file|dir/.test(key)) {
    value = `/docs/${slug(random, hints) || 'notes'}.md`;
  } else if (/name|title|label|subject/.test(key)) {
    value = terms(random, hints, 3);
  } else {
    value = terms(random, hints, 5);
  }
  const maxLength = numberOr(schema.maxLength, Number.POSITIVE_INFINITY);
  const minLength = numberOr(schema.minLength, 0);
  if (value.length > maxLength) value = value.slice(0, maxLength);
  if (value.length < minLength) value = value.padEnd(minLength, 'x');
  return value;
}

function numberFor(
  random: Random,
  name: string,
  schema: Record<string, unknown>,
  integer: boolean,
): number {
  const key = name.toLowerCase();
  const exclusiveMin = numberOr(schema.exclusiveMinimum, Number.NaN);
  const exclusiveMax = numberOr(schema.exclusiveMaximum, Number.NaN);
  const min = Number.isNaN(exclusiveMin)
    ? numberOr(schema.minimum, key === 'offset' ? 0 : 1)
    : exclusiveMin + 1;
  const max = Number.isNaN(exclusiveMax)
    ? numberOr(schema.maximum, min + 19)
    : exclusiveMax - 1;
  const high = Math.max(min, Math.min(max, min + 19));
  if (key === 'offset' && min <= 0) return 0;
  if (integer) return randomInt(random, Math.ceil(min), Math.floor(high));
  return Math.round((min + random() * (high - min)) * 100) / 100;
}

/** A value satisfying `schema` (for the subset tool schemas use). */
export function valueForSchema(
  random: Random,
  schemaValue: unknown,
  name: string,
  hints: ArgumentHints,
  depth = 0,
): unknown {
  const schema = asRecord(schemaValue) ?? {};
  if ('const' in schema) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return pick(random, schema.enum);
  }
  for (const combinator of ['anyOf', 'oneOf', 'allOf'] as const) {
    const options = schema[combinator];
    if (Array.isArray(options) && options.length > 0) {
      const concrete = options.find(
        (option) => asRecord(option)?.type !== 'null',
      );
      return valueForSchema(random, concrete, name, hints, depth);
    }
  }
  switch (schemaType(schema)) {
    case 'integer':
      return numberFor(random, name, schema, true);
    case 'number':
      return numberFor(random, name, schema, false);
    case 'boolean':
      return chance(random, 0.5);
    case 'null':
      return null;
    case 'array': {
      if (depth >= MAX_DEPTH) return [];
      const minItems = numberOr(schema.minItems, 1);
      const maxItems = numberOr(schema.maxItems, 3);
      const items = clamp(randomInt(random, 1, 3), minItems, maxItems);
      const out: unknown[] = [];
      for (let i = 0; i < items; i++) {
        out.push(valueForSchema(random, schema.items, name, hints, depth + 1));
      }
      return out;
    }
    case 'object':
      return objectForSchema(random, schema, hints, depth);
    default:
      return stringFor(random, name, schema, hints);
  }
}

function objectForSchema(
  random: Random,
  schema: Record<string, unknown>,
  hints: ArgumentHints,
  depth: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const properties = asRecord(schema.properties);
  if (!properties || depth >= MAX_DEPTH) return out;
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter(
          (entry): entry is string => typeof entry === 'string',
        )
      : [],
  );
  for (const [key, propertySchema] of Object.entries(properties)) {
    if (!required.has(key) && !chance(random, OPTIONAL_SHARE)) continue;
    out[key] = valueForSchema(random, propertySchema, key, hints, depth + 1);
  }
  return out;
}

/** Arguments for a call of a tool whose parameters are `schema`. */
export function generateToolArguments(
  random: Random,
  schema: Record<string, unknown>,
  hints: ArgumentHints,
): Record<string, unknown> {
  return objectForSchema(random, schema, hints, 0);
}

/**
 * How eagerly the mock calls a tool, by name. Read-only lookups are the
 * common call; tools that reach the public web are rare (a load test must
 * not fan out to real sites); tools that pause for a human, send, pay or
 * delete are never picked unprompted.
 */
function toolWeight(name: string): number {
  const key = name.toLowerCase();
  if (
    /human|ask_user|confirm|approve|delete|remove|send|pay|purchase/.test(key)
  ) {
    return 0;
  }
  if (/web|http|browse|url/.test(key)) return 0.2;
  if (/search|list|query|find|lookup|get|read|fetch/.test(key)) return 4;
  return 1;
}

/**
 * The tool to call among `tools`, or null when none is fit to call.
 * `force` (a `[[mock:tool]]` directive or a required tool choice) settles
 * for the first tool when every weight is zero.
 */
export function chooseTool(
  random: Random,
  tools: readonly OfferedTool[],
  force: boolean,
): OfferedTool | null {
  if (tools.length === 0) return null;
  let total = 0;
  for (const tool of tools) total += toolWeight(tool.name);
  if (total <= 0) return force ? (tools[0] ?? null) : null;
  let roll = random() * total;
  for (const tool of tools) {
    roll -= toolWeight(tool.name);
    if (roll < 0) return tool;
  }
  return tools.at(-1) ?? null;
}
