'use client';

import { useMemo } from 'react';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

import type { CategoryId } from '../components/retention-categories';

interface RawBound {
  category: string;
  min: number;
  max: number;
  default: number;
  unit: 'days' | 'hours';
  source: 'code' | 'env';
}

export interface CategoryBounds {
  min: number;
  max: number;
  default: number;
  unit: 'days' | 'hours';
  /** `'env'` when the operator set a tighter min/max via env var. The
   *  UI surfaces "Operator caps this at N {unit}" helper text in this
   *  case. */
  source: 'code' | 'env';
}

/**
 * Phase 13 — `useRetentionBounds(orgId)` resolves effective per-category
 * bounds from `getEffectiveRetentionBounds`.
 *
 * Returns a map keyed by `CategoryId`. Categories without a bound row
 * (shouldn't happen, but defensive) get `undefined` so callers fall
 * back to schema-level defaults.
 */
export function useRetentionBounds(organizationId: string | undefined) {
  const result = useConvexQuery(
    api.governance.queries.getEffectiveRetentionBounds,
    organizationId ? { organizationId } : 'skip',
  );

  const map = useMemo(() => {
    const bounds = (result.data?.bounds ?? []) as RawBound[];
    const out = new Map<CategoryId, CategoryBounds>();
    for (const b of bounds) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- backend returns RetentionCategory ids which are CategoryId by contract
      const id = b.category as CategoryId;
      out.set(id, {
        min: b.min,
        max: b.max,
        default: b.default,
        unit: b.unit,
        source: b.source,
      });
    }
    return out;
  }, [result.data?.bounds]);

  return {
    bounds: map,
    retentionDisabled: result.data?.retentionDisabled ?? false,
    isLoading: result.isLoading,
  };
}
