'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useConvexClient } from '@/app/hooks/use-convex-client';
import { api } from '@/convex/_generated/api';

import type { CategoryId } from '../components/retention-categories';

interface RawEnvBinding {
  envName: string;
  source: 'metadata' | 'none';
  applied: boolean;
}

interface RawBound {
  category: string;
  min: number;
  max: number;
  default: number;
  unit: 'days' | 'hours';
  source: 'file' | 'env';
  minEnv: RawEnvBinding;
  maxEnv: RawEnvBinding;
  defaultEnv: RawEnvBinding;
}

export interface EnvBindingInfo {
  envName: string;
  /** `'metadata'` = declared in the JSON file's root `_metadata.envNames`.
   *  `'none'` = no entry maps to this `${category}.${field}` path, so
   *  the field has no env binding. */
  source: 'metadata' | 'none';
  /** Whether `process.env[envName]` is currently set (and tightening). */
  applied: boolean;
}

export interface CategoryBounds {
  min: number;
  max: number;
  default: number;
  /** Time unit for `min`/`max`/`default` — backend reads this from
   *  the JSON file's per-category `unit` field (single SoT). */
  unit: 'days' | 'hours';
  /** `'env'` when the operator set a tighter min/max via env var. The
   *  UI surfaces "Operator caps this at N {unit}" helper text in this
   *  case. */
  source: 'file' | 'env';
  /** Resolution detail for the `min` env binding. */
  minEnv: EnvBindingInfo;
  /** Resolution detail for the `max` env binding. */
  maxEnv: EnvBindingInfo;
  /** Resolution detail for the `default` env binding. */
  defaultEnv: EnvBindingInfo;
}

/**
 * Resolves effective per-category bounds via the V8 action
 * `getRetentionBoundsAction`. The action reads the per-org JSON file
 * (with `default` org fallback) and applies env tightening — see
 * `convex/governance/retention_floors.ts` + `retention_actions.ts`.
 *
 * Bounds are NOT reactive (they came from a Convex query before, but
 * the file-canonical refactor moved reads to a V8 action). Editor
 * fetches once on open + on `organizationId` change. Operators editing
 * the JSON file see changes after the next editor reload.
 *
 * Returns a map keyed by `CategoryId`. Categories without a bound row
 * (shouldn't happen post-refactor — file is exhaustive) get
 * `undefined` so callers fall back to schema-level defaults.
 */
export function useRetentionBounds(organizationId: string | undefined) {
  const convex = useConvexClient();
  const result = useQuery({
    queryKey: ['retention-bounds', organizationId ?? null],
    queryFn: async () => {
      if (!organizationId) return null;
      return convex.action(
        api.governance.retention_actions.getRetentionBoundsAction,
        { organizationId },
      );
    },
    enabled: !!organizationId,
    staleTime: 60_000,
  });

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
        minEnv: b.minEnv,
        maxEnv: b.maxEnv,
        defaultEnv: b.defaultEnv,
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
