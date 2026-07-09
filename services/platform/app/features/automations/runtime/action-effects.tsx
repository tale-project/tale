'use client';

/**
 * The automation framework's generic, declarative action-effect layer — the "then" half
 * of an action. An action declares an optional `onSuccess` effect (data, a closed
 * named set — never code); after the action resolves, `useActionEffect` runs it.
 * Effect fields support the same binding templates as action args — `$result.*`
 * (the action's return), `$selected.*` (the bound row), `$orgId`, `$tpl:` —
 * so an effect can read e.g. a created id or the row it acted on.
 *
 * Modeled on the converged low-code action vocabulary (Appsmith widget actions /
 * Adaptive Cards' named action schema): a small, extensible union driving
 * primitives we already own (TanStack Router, the resource-detail overlay, the
 * toast store, the view-state store). The union is `actionEffectSchema`
 * (`lib/shared/schemas/automation_views.ts`) — the type here is its `z.infer`, so the
 * schema and the runtime can't drift: `openDetail`, `navigate`, `toast`
 * (literal title, `$tpl:`-capable), and `setState` (cross-block view state,
 * e.g. select the row a Form just created).
 */
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import type { z } from 'zod';

import { toast } from '@/app/hooks/use-toast';
import { resolveBindingArgs } from '@/lib/shared/platform/function_bindings';
import type { actionEffectSchema } from '@/lib/shared/schemas/automation_views';
import { isRecord } from '@/lib/utils/type-utils';

import { useAutomationRuntime } from './automation-runtime';
import { useResourceDetail } from './resource-detail';
import { useOptionalViewState } from './view-state';

/** The declarative `onSuccess` union — `z.infer` of the view-schema fragment. */
export type ActionEffect = z.infer<typeof actionEffectSchema>;

/** The live context an effect's templates resolve against. */
export interface EffectContext {
  organizationId: string;
  /** Bound project id for a project-scoped automation; undefined for org-scoped automations. */
  projectId?: string;
  selected?: Record<string, unknown>;
  result?: Record<string, unknown>;
  /** The automation's per-install config values (`$config:`/template `{key}`). */
  config?: Record<string, unknown>;
  /** Cross-block view state (`$state.<key>` references inside effect fields). */
  state?: Record<string, unknown>;
}

/** A fully resolved, ready-to-apply effect (or null when it can't/shouldn't run). */
export type ResolvedEffect =
  | { kind: 'openDetail'; subjectType: string; id: string; title?: string }
  | {
      kind: 'navigate';
      to: string;
      params?: Record<string, unknown>;
      search?: Record<string, unknown>;
    }
  | { kind: 'toast'; title: string }
  | { kind: 'setState'; key: string; value: unknown }
  | null;

// `$selected`/`$result` sentinels pass through resolveBindingArgs UNCHANGED when
// their context is absent (e.g. `$result.*` against a non-record return, or a
// `$selected.*` effect run without a row). A resolved value still bearing that
// shape is therefore unresolved, not a literal id/route — bail rather than open a
// broken overlay or navigate to a garbage route. ($orgId always resolves; $tpl:
// always produces a string; a legit "$5" title doesn't match this.)
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
    const search =
      effect.search === undefined
        ? undefined
        : resolveBindingArgs(effect.search, ctx);
    return {
      kind: 'navigate',
      to,
      params: isRecord(params) ? params : undefined,
      search: isRecord(search) ? search : undefined,
    };
  }
  if (effect.kind === 'toast') {
    // `titleKey` is a literal display string; `$tpl:` interpolation over the
    // row/config still applies via `resolveBindingArgs`.
    const title = resolve(effect.titleKey);
    if (!title) return null;
    return { kind: 'toast', title };
  }
  if (effect.kind === 'setState') {
    const value = resolveBindingArgs(effect.value, ctx);
    // A still-sentinel string means the reference didn't resolve (e.g.
    // `$result.id` on a scalar return) — don't write garbage into view state.
    // A resolved `undefined` is a legitimate write: it CLEARS the key.
    if (typeof value === 'string' && UNRESOLVED_SENTINEL.test(value)) {
      return null;
    }
    return { kind: 'setState', key: effect.key, value };
  }
  return null;
}

/**
 * Returns an applier: given an action's `onSuccess` effect, its result, and the
 * row it acted on, resolves the effect and runs it. No-op when the effect is
 * absent or unresolvable. Safe to call from any connected block — `setState`
 * needs the view's `ViewStateProvider`; outside one it warns and skips (the
 * other effects still run standalone).
 */
export function useActionEffect(): (
  effect: ActionEffect | undefined,
  result: unknown,
  selected?: Record<string, unknown>,
) => void {
  const navigate = useNavigate();
  const { open } = useResourceDetail();
  const { organizationId, projectId, config } = useAutomationRuntime();
  const viewState = useOptionalViewState();

  return useCallback(
    (effect, result, selected) => {
      const resolved = resolveEffect(effect, {
        organizationId,
        projectId,
        selected,
        result: isRecord(result) ? result : undefined,
        config,
        state: viewState?.state,
      });
      if (!resolved) return;
      switch (resolved.kind) {
        case 'openDetail':
          open({
            subjectType: resolved.subjectType,
            id: resolved.id,
            title: resolved.title,
          });
          return;
        case 'toast':
          toast({ title: resolved.title });
          return;
        case 'setState':
          if (!viewState) {
            console.warn(
              '[automation-effects] setState effect outside a ViewStateProvider — skipped',
              resolved.key,
            );
            return;
          }
          viewState.setState(resolved.key, resolved.value);
          return;
        case 'navigate': {
          // Config-driven route string: the typed router can't statically check
          // it, so call through a loosened signature (config is first-party +
          // validated).
          const go = navigate as (opts: {
            to: string;
            params?: Record<string, unknown>;
            search?: Record<string, unknown>;
          }) => Promise<void>;
          void go({
            to: resolved.to,
            params: resolved.params,
            search: resolved.search,
          });
          return;
        }
      }
    },
    [navigate, open, organizationId, projectId, config, viewState],
  );
}
