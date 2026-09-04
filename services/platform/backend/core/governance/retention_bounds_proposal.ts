import {
  RETENTION_CATEGORIES,
  type AppliedBoundsByCategory,
} from '../../../lib/shared/schemas/retention';
import { isRecord } from '../../../lib/utils/type-utils';
import { RETENTION_POLICY_FIELD_BY_CATEGORY } from './retention_floors';

export interface BoundDiffEntry {
  category: string;
  field: 'min' | 'max';
  /** `null` = the category was not bounded in the applied snapshot. */
  from: number | null;
  /** `null` = the proposal no longer bounds the category. */
  to: number | null;
  direction: 'tighten' | 'loosen';
}

interface ImpactEntry {
  category: string;
  field: string;
  current: number;
  willClampTo: number;
}

/**
 * Per-category diff between two `AppliedBoundsByCategory` snapshots.
 * `tighten` = floor raised OR ceiling lowered; `loosen` = the reverse.
 * Identical values are omitted.
 *
 * A category present on only one side is a real change too — the hash
 * includes it, so the banner fires; omitting it here produced the
 * "0 of 0 change(s)" empty proposal (e.g. after a release ships a new
 * retention category that the org's applied snapshot predates). Newly
 * bounded = `tighten` with `from: null`; no longer bounded = `loosen`
 * with `to: null`. Exported for tests: an empty diff must imply an
 * unchanged hash.
 */
export function diffBounds(
  from: AppliedBoundsByCategory | null,
  to: AppliedBoundsByCategory,
): BoundDiffEntry[] {
  const out: BoundDiffEntry[] = [];
  for (const cat of RETENTION_CATEGORIES) {
    const a = from?.[cat];
    const b = to[cat];
    if (!a && !b) continue;
    if (!b) {
      // `a` is defined here: dropping an enforced floor + ceiling loosens.
      out.push(
        {
          category: cat,
          field: 'min',
          from: a?.min ?? null,
          to: null,
          direction: 'loosen',
        },
        {
          category: cat,
          field: 'max',
          from: a?.max ?? null,
          to: null,
          direction: 'loosen',
        },
      );
      continue;
    }
    if (!a) {
      // Enforcing bounds where none were applied before tightens.
      out.push(
        {
          category: cat,
          field: 'min',
          from: null,
          to: b.min,
          direction: 'tighten',
        },
        {
          category: cat,
          field: 'max',
          from: null,
          to: b.max,
          direction: 'tighten',
        },
      );
      continue;
    }
    if (b.min !== a.min) {
      out.push({
        category: cat,
        field: 'min',
        from: a.min,
        to: b.min,
        direction: b.min > a.min ? 'tighten' : 'loosen',
      });
    }
    if (b.max !== a.max) {
      out.push({
        category: cat,
        field: 'max',
        from: a.max,
        to: b.max,
        direction: b.max < a.max ? 'tighten' : 'loosen',
      });
    }
  }
  return out;
}

/**
 * For each diffed category, project what would happen to the org's
 * stored retention value if the proposal is applied. Reads
 * `governancePolicies.retention_policy.config` and clamps each
 * `<category>RetentionDays/Hours` field to the proposed `[min, max]` —
 * the same field↔category pairing `clampConfigToBounds` enforces, so the
 * preview can only promise what the sweep does.
 */
export function buildImpactPreview(
  proposed: AppliedBoundsByCategory,
  storedConfig: unknown,
): ImpactEntry[] {
  if (!isRecord(storedConfig)) return [];
  const out: ImpactEntry[] = [];
  for (const cat of RETENTION_CATEGORIES) {
    const bound = proposed[cat];
    if (!bound) continue;
    const field = RETENTION_POLICY_FIELD_BY_CATEGORY[cat];
    const current = storedConfig[field];
    if (typeof current !== 'number' || !Number.isFinite(current)) continue;
    const clamped = Math.min(Math.max(current, bound.min), bound.max);
    if (clamped !== current) {
      out.push({ category: cat, field, current, willClampTo: clamped });
    }
  }
  return out;
}
