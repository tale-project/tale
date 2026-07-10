'use client';

/**
 * Shared visibility gate for automation view blocks (`Form`, `Text`, `Alert`,
 * …). Optional `when` + `whenQuery` hide the block when the predicate fails
 * against the query result (or `{}` when the query returns null) — same
 * grammar as row-action `when` (`evaluateWhen`).
 */
import { argsReferenceProjectId } from '@/lib/shared/platform/function_bindings';
import { evaluateWhen } from '@/lib/shared/platform/when_predicate';
import { isRecord } from '@/lib/utils/type-utils';

import { useBoundQuery } from '../hooks/use-bound-query';
import { useAutomationRuntime } from '../runtime/automation-runtime';

export type BlockWhenGate =
  /** No `when` declared — always render. */
  | { decision: 'ungated' }
  /** Gate query still loading or blocked — hide. */
  | { decision: 'pending' }
  /**
   * Gate query args unresolved. When `needsProject` is true the caller should
   * show the project empty state; otherwise hide.
   */
  | { decision: 'needsConfig'; needsProject: boolean }
  /** Predicate failed — hide. */
  | { decision: 'hide' }
  /** Predicate passed — render. */
  | { decision: 'show' };

export function useBlockWhenGate(
  when: string | undefined,
  whenQuery: { path: string; args?: unknown } | undefined,
): BlockWhenGate {
  const runtime = useAutomationRuntime();
  const gateQuery = useBoundQuery(whenQuery?.path ?? '', whenQuery?.args ?? {});

  if (when === undefined) return { decision: 'ungated' };

  if (whenQuery && (gateQuery.isLoading || gateQuery.blocked)) {
    return { decision: 'pending' };
  }

  if (whenQuery && gateQuery.needsConfig) {
    const needsProject =
      runtime.projectId === undefined && argsReferenceProjectId(whenQuery.args);
    return { decision: 'needsConfig', needsProject };
  }

  const whenItem: Record<string, unknown> = isRecord(gateQuery.data)
    ? gateQuery.data
    : {};
  if (!evaluateWhen(when, whenItem)) return { decision: 'hide' };
  return { decision: 'show' };
}
