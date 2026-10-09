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

import { valueHash } from '@tale/ui/data/hash';
import { inferSchema } from '@tale/ui/data/infer-schema';
import { pointerOf } from '@tale/ui/data/json-pointer';
import { jsonNormalize, stableStringify } from '@tale/ui/data/stable-stringify';
import { summaryOf } from '@tale/ui/data/value-summary';

import { isSensitiveKey } from '../../../shared/audit-redaction';
import { boundJsonOutOfBand } from '../../../shared/utils/bound-json';
import { credentialKind } from '../secret-patterns';
import type { Json } from '../types';
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
}

/**
 * A step's own input and output (`node`), one item's or one pass's
 * (`unit`), and a value seen once and not stored with a run (`transient`,
 * a test of a single step).
 */
export const RECORD_LIMITS = {
  node: { maxString: 4096, maxItems: 50, maxDepth: 10, ceiling: 32_768 },
  unit: { maxString: 1024, maxItems: 20, maxDepth: 8, ceiling: 8192 },
  transient: {
    maxString: 65_536,
    maxItems: 1000,
    maxDepth: 12,
    ceiling: 262_144,
  },
} as const satisfies Record<string, RecordLimits>;

export type RecordTier = keyof typeof RECORD_LIMITS;

/** UTF-8 bytes of stored values one durable run may keep: 2 MiB. */
export const RECORD_RUN_BUDGET = 2_097_152;

/** Entries kept in a record's `redacted` and `elided` lists. */
const RECORD_MAX_MARKS = 100;

/** How shapes are read for a record: lists by their first 20 items, six
 * levels deep. */
const SHAPE_OPTIONS = { sampleItems: 20, maxDepth: 6 } as const;

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

/**
 * `value` as plain JSON with every secret withheld: a member whose name
 * marks a secret (`password`, `apiKey`, `accessToken`, …) and a string that
 * looks like a credential become `null`, each listed with why. Numbers and
 * booleans under a secret's name stay — a count such as `inputTokens` is
 * not a credential, and a flag such as `hasPassword` says nothing of one.
 * Up to {@link RECORD_MAX_MARKS} places are listed; every one is withheld.
 */
export function redactValue(value: unknown): {
  value: Json | undefined;
  redacted: ValueRedaction[];
} {
  const redacted: ValueRedaction[] = [];
  const path: Array<string | number> = [];
  const mark = (why: ValueRedaction['why']): null => {
    if (redacted.length < RECORD_MAX_MARKS) {
      redacted.push({ pointer: pointerOf(path), why });
    }
    return null;
  };
  const walk = (entry: Json, key?: string): Json => {
    if (typeof entry === 'string') {
      return credentialKind(entry, key) === undefined ? entry : mark('pattern');
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
      for (const [member, item] of Object.entries(entry)) {
        path.push(member);
        out[member] =
          isSensitiveKey(member) &&
          item !== null &&
          typeof item !== 'number' &&
          typeof item !== 'boolean'
            ? mark('key')
            : walk(item, member);
        path.pop();
      }
      return out;
    }
    return entry;
  };
  const plain = toJson(value);
  return { value: plain === undefined ? undefined : walk(plain), redacted };
}

/**
 * Cut `value` (plain JSON) to `limits`, listing each cut: strings end
 * cleanly, lists keep their first items, deeper levels read `null`, and a
 * value still past the ceiling is not kept at all (`null`, one `whole` cut).
 */
export function boundRecorded(
  value: Json,
  limits: RecordLimits,
): { value: Json; elided: ValueElision[] } {
  const bounded = boundJsonOutOfBand(value, limits, RECORD_MAX_MARKS);
  // Cutting JSON leaves JSON: strings, shorter lists and nulls.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- bounded from a Json value
  const kept = (bounded.value ?? null) as Json;
  const bytes = utf8Bytes(stableStringify(kept));
  if (bytes > limits.ceiling) {
    return {
      value: null,
      elided: [{ pointer: '', kind: 'whole', dropped: bytes }],
    };
  }
  return { value: kept, elided: [...bounded.cuts] };
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
  const { value: withheld, redacted } = redactValue(value);
  const summary = summaryOf(withheld);
  const bytes = summary.bytes ?? 0;
  const record: ValueRecord = {
    summary,
    shape: inferSchema(withheld, SHAPE_OPTIONS),
    bytes,
    hash:
      withheld !== undefined && bytes <= RECORD_HASH_MAX_BYTES
        ? valueHash(withheld)
        : null,
  };
  if (redacted.length > 0) record.redacted = redacted;
  if (withheld === undefined) return record;
  const bounded = boundRecorded(withheld, RECORD_LIMITS[tier]);
  if (bounded.elided.length > 0) record.elided = bounded.elided;
  const cost = utf8Bytes(stableStringify(bounded.value));
  if (cost <= budget.left) {
    budget.left -= cost;
    record.value = bounded.value;
  }
  return record;
}

/** `value` as the JSON a reader of its text would get. */
function toJson(value: unknown): Json | undefined {
  // jsonNormalize answers what JSON.parse answers: plain JSON data.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON.parse output is Json by construction
  return jsonNormalize(value) as Json | undefined;
}
