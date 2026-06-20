'use client';

/**
 * The app framework's generic, declarative action-effect layer — the "then" half
 * of an action. An action declares an optional `onSuccess` effect (data, a closed
 * named set — never code); after the action resolves, `useActionEffect` runs it.
 * Effect fields support the same binding templates as action args — `$result.*`
 * (the action's return), `$selected.*` (the bound row), `$orgId`, `$tpl:`,
 * `$label:` — so an effect can read e.g. a created id or the row it acted on.
 *
 * Modeled on the converged low-code action vocabulary (Appsmith widget actions /
 * Adaptive Cards' named action schema): a small, extensible union driving
 * primitives we already own (TanStack Router + the resource-detail overlay), not
 * a bespoke framework. Ships with `openDetail` + `navigate`; the union admits
 * more (toast, refresh) later.
 */
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { resolveBindingArgs } from '@/lib/shared/platform/function_bindings';
import { isRecord } from '@/lib/utils/type-utils';

import { useAppRuntime } from './app-runtime';
import { useResourceDetail } from './resource-detail';

/** Open the generic resource-detail overlay for a polymorphic `(subjectType, id)`. */
export interface OpenDetailEffect {
  kind: 'openDetail';
  subjectType: string;
  id: string;
  title?: string;
}

/** Navigate to a route (e.g. an existing run-detail route). */
export interface NavigateEffect {
  kind: 'navigate';
  to: string;
  params?: Record<string, unknown>;
}

export type ActionEffect = OpenDetailEffect | NavigateEffect;

/** The live context an effect's templates resolve against. */
export interface EffectContext {
  organizationId: string;
  selected?: Record<string, unknown>;
  result?: Record<string, unknown>;
  labels?: Record<string, string>;
}

/** A fully resolved, ready-to-apply effect (or null when it can't/shouldn't run). */
export type ResolvedEffect =
  | { kind: 'openDetail'; subjectType: string; id: string; title?: string }
  | { kind: 'navigate'; to: string; params?: Record<string, unknown> }
  | null;

// `$selected`/`$result` sentinels pass through resolveBindingArgs UNCHANGED when
// their context is absent (e.g. `$result.*` against a non-record return, or a
// `$selected.*` effect run without a row). A resolved value still bearing that
// shape is therefore unresolved, not a literal id/route — bail rather than open a
// broken overlay or navigate to a garbage route. ($orgId always resolves; $tpl:/
// $label: always produce a string; a legit "$5" title doesn't match this.)
const UNRESOLVED_SENTINEL = /^\$(selected|result)(\.|$)/;

/**
 * Resolve an `onSuccess` effect's templated fields against `ctx`. Pure (no React),
 * so it's unit-testable. Returns null when the effect is absent or a required
 * field doesn't resolve to a usable value.
 */
export function resolveEffect(
  effect: ActionEffect | undefined,
  ctx: EffectContext,
): ResolvedEffect {
  if (!effect) return null;
  const resolve = (tpl: string): string | undefined => {
    const v = resolveBindingArgs(tpl, ctx);
    return typeof v === 'string' && !UNRESOLVED_SENTINEL.test(v)
      ? v
      : undefined;
  };

  if (effect.kind === 'openDetail') {
    const id = resolve(effect.id);
    if (!id) return null;
    const title = effect.title ? resolve(effect.title) : undefined;
    return { kind: 'openDetail', subjectType: effect.subjectType, id, title };
  }
  if (effect.kind === 'navigate') {
    const to = resolve(effect.to);
    if (!to) return null;
    const params = resolveBindingArgs(effect.params ?? {}, ctx);
    return {
      kind: 'navigate',
      to,
      params: isRecord(params) ? params : undefined,
    };
  }
  return null;
}

/**
 * Returns an applier: given an action's `onSuccess` effect, its result, and the
 * row it acted on, resolves the effect and runs it. No-op when the effect is
 * absent or unresolvable. Safe to call from any connected block.
 */
export function useActionEffect(): (
  effect: ActionEffect | undefined,
  result: unknown,
  selected?: Record<string, unknown>,
) => void {
  const navigate = useNavigate();
  const { open } = useResourceDetail();
  const { organizationId, labels } = useAppRuntime();

  return useCallback(
    (effect, result, selected) => {
      const resolved = resolveEffect(effect, {
        organizationId,
        selected,
        result: isRecord(result) ? result : undefined,
        labels,
      });
      if (!resolved) return;
      if (resolved.kind === 'openDetail') {
        open({
          subjectType: resolved.subjectType,
          id: resolved.id,
          title: resolved.title,
        });
      } else {
        // Config-driven route string: the typed router can't statically check it,
        // so call through a loosened signature (config is first-party + validated).
        const go = navigate as (opts: {
          to: string;
          params?: Record<string, unknown>;
        }) => Promise<void>;
        void go({ to: resolved.to, params: resolved.params });
      }
    },
    [navigate, open, organizationId, labels],
  );
}
