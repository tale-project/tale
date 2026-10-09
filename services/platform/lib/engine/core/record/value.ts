/**
 * How a step's value is recorded: secrets withheld, then summarized, shaped
 * and hashed from the whole withheld value, then cut to its tier's limits —
 * every cut listed beside the value, never written into it — and finally
 * held to what the run may still store.
 *
 * Withholding comes first so a cut can never leave a secret's tail behind.
 * Only descriptive copies pass through here: a step's checkpoint output, the
 * run's input and output and its side effects are execution state and stay
 * whole.
 */

import { cyrb53 } from '@tale/ui/data/hash';
import { inferSchema } from '@tale/ui/data/infer-schema';
import { pointerOf } from '@tale/ui/data/json-pointer';
import { jsonNormalize, stableStringify } from '@tale/ui/data/stable-stringify';
import { summaryOf, type ValueSummary } from '@tale/ui/data/value-summary';

import { boundJsonOutOfBand } from '../../../shared/utils/bound-json';
import { looksLikeCredential, secretMemberName } from '../secret-patterns';
import type { Json, NodeTrace } from '../types';
import {
  RECORD_HASH_MAX_BYTES,
  type ValueElision,
  type ValueRecord,
  type ValueRedaction,
} from './types';

export interface RecordLimits {
  /** Characters kept per string. */
  readonly maxString: number;
  /** List entries kept. */
  readonly maxItems: number;
  /** Nesting levels kept; deeper values read `null`. */
  readonly maxDepth: number;
  /** UTF-8 bytes of the cut value as JSON; past it nothing is kept. */
  readonly ceiling: number;
  /** Shapes kept in the value's shape, so the shape stays small however
   * wide the value is. */
  readonly shapeNodes: number;
}

/**
 * A step's own input and output (`node`), one item's or one pass's
 * (`unit`), and a value seen once and not stored with a run (`transient`,
 * a test of a single step).
 */
export const RECORD_LIMITS = {
  node: {
    maxString: 4096,
    maxItems: 50,
    maxDepth: 10,
    ceiling: 32_768,
    shapeNodes: 400,
  },
  unit: {
    maxString: 1024,
    maxItems: 20,
    maxDepth: 8,
    ceiling: 8192,
    shapeNodes: 100,
  },
  transient: {
    maxString: 65_536,
    maxItems: 1000,
    maxDepth: 12,
    ceiling: 262_144,
    shapeNodes: 2000,
  },
} as const satisfies Record<string, RecordLimits>;

export type RecordTier = keyof typeof RECORD_LIMITS;

/** UTF-8 bytes of stored values one durable run may keep: 2 MiB. */
export const RECORD_RUN_BUDGET = 2_097_152;

/** Entries kept in a record's `redacted` and `elided` lists. */
const RECORD_MAX_MARKS = 100;

/** Member names longer than this are left out: no reader needs the name
 * whole, and it would ride along in every pointer below it. */
const MAX_MEMBER_NAME = 256;

/** How shapes are read for a record: lists by their first 20 items, six
 * levels deep, fifty fields per object. */
const SHAPE_OPTIONS = {
  sampleItems: 20,
  maxDepth: 6,
  maxProperties: 50,
} as const;

/** What a run may still store, in UTF-8 bytes; spent as values are kept. */
export interface RecordBudget {
  left: number;
}

/** The budget of a run that has already stored `spent` bytes. */
export function recordBudget(spent = 0): RecordBudget {
  return { left: Math.max(0, RECORD_RUN_BUDGET - spent) };
}

/** A budget that is never spent, for values not stored with a run. */
export function unlimitedBudget(): RecordBudget {
  return { left: Number.POSITIVE_INFINITY };
}

const encoder = new TextEncoder();

function utf8Bytes(text: string): number {
  return encoder.encode(text).length;
}

/** Set `key` on `target` as its own member, `__proto__` included. */
function setOwn(target: Record<string, Json>, key: string, value: Json): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/**
 * `value` as plain JSON with every secret withheld:
 *  - a member whose name marks a secret outright (`password`, `apiKey`,
 *    `pin`, …) holds `null` unless it held a flag or nothing — a numeric
 *    PIN is a secret too;
 *  - a member whose name only mentions a token (`nextPageToken`) holds
 *    `null` when it held text, and is read member by member otherwise
 *    (`prompt_tokens_details`); a count such as `inputTokens` stays;
 *  - text that looks like a credential is `null`, wherever it sits;
 *  - a member whose name looks like a credential, or is longer than any
 *    reader needs, is left out.
 * Each place is listed, up to {@link RECORD_MAX_MARKS}; `total` counts them
 * all.
 */
export function redactValue(value: unknown): {
  value: Json | undefined;
  redacted: ValueRedaction[];
  total: number;
} {
  const redacted: ValueRedaction[] = [];
  let total = 0;
  const path: Array<string | number> = [];
  const mark = (why: ValueRedaction['why']): null => {
    total++;
    if (redacted.length < RECORD_MAX_MARKS) {
      redacted.push({ pointer: pointerOf(path), why });
    }
    return null;
  };
  const walk = (entry: Json, key?: string): Json => {
    if (typeof entry === 'string') {
      return looksLikeCredential(entry, key) ? mark('pattern') : entry;
    }
    if (Array.isArray(entry)) {
      return entry.map((item, index) => {
        path.push(index);
        const out = walk(item);
        path.pop();
        return out;
      });
    }
    if (entry !== null && typeof entry === 'object') {
      const out: Record<string, Json> = {};
      let leftOut = false;
      for (const [member, item] of Object.entries(entry)) {
        if (member.length > MAX_MEMBER_NAME || looksLikeCredential(member)) {
          leftOut = true;
          continue;
        }
        path.push(member);
        setOwn(
          out,
          member,
          withheld(member, item) ? mark('key') : walk(item, member),
        );
        path.pop();
      }
      if (leftOut) mark('name');
      return out;
    }
    return entry;
  };
  const plain = toJson(value);
  return {
    value: plain === undefined ? undefined : walk(plain),
    redacted,
    total,
  };
}

/** Whether the member `name` holding `item` is withheld whole. */
function withheld(name: string, item: Json): boolean {
  if (item === null || typeof item === 'boolean') return false;
  const kind = secretMemberName(name);
  if (kind === 'strong') return true;
  return kind === 'weak' && typeof item === 'string';
}

/**
 * A summary safe to keep: text that looks like a credential reads
 * `redacted`, and object member names that look like one are left out.
 * For a value seen without its member name — a sub-expression's value in a
 * condition — where only its text can say it is a secret.
 */
export function redactSummary(summary: ValueSummary): ValueSummary {
  if (summary.text !== undefined && looksLikeCredential(summary.text)) {
    return { kind: 'redacted' };
  }
  const out: ValueSummary = { ...summary };
  if (summary.names !== undefined) {
    out.names = summary.names.filter((name) => !looksLikeCredential(name));
  }
  if (summary.items !== undefined) out.items = summary.items.map(redactSummary);
  return out;
}

/** The summary of `value` with its secrets withheld, as a record keeps it:
 * for a value a decision read (`forEach`'s list, a condition's result). */
export function recordedSummary(value: unknown): ValueSummary {
  const { value: plain, redacted } = redactValue(value);
  if (redacted.some((mark) => mark.pointer === '' && mark.why !== 'name')) {
    return { kind: 'redacted' };
  }
  return summaryOf(plain);
}

/**
 * Cut `value` (plain JSON) to `limits`, listing each cut: strings end
 * cleanly, lists keep their first items, deeper levels read `null`, and a
 * value still past the ceiling is not kept at all (`null`, one `whole` cut).
 */
export function boundRecorded(
  value: Json,
  limits: Omit<RecordLimits, 'shapeNodes'>,
): { value: Json; elided: ValueElision[]; total: number } {
  const bounded = boundJsonOutOfBand(value, limits, RECORD_MAX_MARKS);
  // Cutting JSON leaves JSON: strings, shorter lists and nulls.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bounded from a Json value
  const kept = (bounded.value ?? null) as Json;
  const bytes = utf8Bytes(stableStringify(kept));
  if (bytes > limits.ceiling) {
    return {
      value: null,
      elided: [{ pointer: '', kind: 'whole', dropped: bytes }],
      total: 1,
    };
  }
  return { value: kept, elided: [...bounded.cuts], total: bounded.total };
}

/**
 * Record `value` at `tier`, spending what is stored from `budget`. A value
 * the budget can no longer hold keeps its summary, shape, size and hash and
 * leaves out the value itself.
 */
export function recordValue(
  value: unknown,
  tier: RecordTier,
  budget: RecordBudget,
): ValueRecord {
  const limits = RECORD_LIMITS[tier];
  const { value: withheldValue, redacted, total } = redactValue(value);
  const rootWithheld = redacted.some(
    (mark) => mark.pointer === '' && mark.why !== 'name',
  );
  const text =
    withheldValue === undefined ? undefined : stableStringify(withheldValue);
  const bytes = text === undefined ? 0 : utf8Bytes(text);
  const record: ValueRecord = {
    summary: rootWithheld ? { kind: 'redacted' } : summaryOf(withheldValue),
    shape: rootWithheld
      ? {}
      : inferSchema(withheldValue, {
          ...SHAPE_OPTIONS,
          maxNodes: limits.shapeNodes,
        }),
    bytes,
    hash:
      text !== undefined && bytes <= RECORD_HASH_MAX_BYTES
        ? cyrb53(text)
        : null,
  };
  if (redacted.length > 0) record.redacted = redacted;
  if (total > redacted.length) record.redactedTotal = total;
  if (withheldValue === undefined) return record;
  const bounded = boundRecorded(withheldValue, limits);
  if (bounded.elided.length > 0) record.elided = bounded.elided;
  if (bounded.total > bounded.elided.length) {
    record.elidedTotal = bounded.total;
  }
  const cost = utf8Bytes(stableStringify(bounded.value));
  if (cost <= budget.left) {
    budget.left -= cost;
    record.value = bounded.value;
  }
  return record;
}

/**
 * A trace with its secrets withheld: each entry's input and output, read by
 * the rule a record's values are, so a run's trace and its record agree.
 * For a trace served as it was made (an in-process run's result).
 */
export function redactTrace(trace: readonly NodeTrace[]): NodeTrace[] {
  return trace.map((entry) => {
    const out: NodeTrace = { ...entry };
    if (entry.input !== undefined) out.input = redactValue(entry.input).value;
    if (entry.output !== undefined) {
      out.output = redactValue(entry.output).value;
    }
    return out;
  });
}

/** `value` as the JSON a reader of its text would get. */
function toJson(value: unknown): Json | undefined {
  // jsonNormalize answers what JSON.parse answers: plain JSON data.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON.parse output is Json by construction
  return jsonNormalize(value) as Json | undefined;
}
