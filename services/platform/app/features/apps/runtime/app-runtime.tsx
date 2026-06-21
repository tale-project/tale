'use client';

/**
 * Runtime context for a rendered app: the current org, the app slug, and the
 * app's capability allowlist (`capabilities.functions`). Connected registry
 * blocks read this to bind to Convex functions, gated by the allowlist. Wraps
 * the Puck `<Render>` in `app-page.tsx`.
 */
import { createContext, useContext } from 'react';

import type { FunctionBinding } from '@/lib/shared/platform/function_bindings';

export interface AppRuntime {
  organizationId: string;
  appSlug: string;
  /** The app's declared function allowlist (capabilities.functions). */
  allowlist: FunctionBinding[];
  /**
   * The app's pack-authored label catalog for the ACTIVE locale, a flat
   * `{ labelKey: string }` map (resolved from `messages/<locale>.json`).
   * Connected blocks resolve `ui.labelKey` against this via `usePackLabel`.
   */
  labels: Record<string, string>;
}

const AppRuntimeContext = createContext<AppRuntime | null>(null);

export function AppRuntimeProvider({
  value,
  children,
}: {
  value: AppRuntime;
  children: React.ReactNode;
}) {
  return (
    <AppRuntimeContext.Provider value={value}>
      {children}
    </AppRuntimeContext.Provider>
  );
}

export function useAppRuntime(): AppRuntime {
  const value = useContext(AppRuntimeContext);
  if (!value) {
    throw new Error('useAppRuntime must be used within an AppRuntimeProvider');
  }
  return value;
}

/**
 * Resolve a pack `ui.labelKey` (e.g. `issueDesk.assign`) against the app's
 * active-locale catalog, falling back to the given text when the key is absent
 * — so a label always renders even if the app ships no catalog for it.
 *
 * Reads the context DIRECTLY (not via `useAppRuntime`) so it never throws when
 * used outside a provider — the operator run view resolves pack labels through
 * this too, and a panel must degrade to its fallback rather than crash.
 */
export function usePackLabel(): (
  labelKey: string | undefined,
  fallback: string,
) => string {
  const rt = useContext(AppRuntimeContext);
  return (labelKey, fallback) => (labelKey && rt?.labels[labelKey]) || fallback;
}

/**
 * Resolve a view-authored DISPLAY string against the pack catalog. A view writes
 * `$label:<key>` (the same marker the arg-template resolver uses) for a localized
 * string, or a plain literal otherwise — so titles/labels localize while existing
 * literal-only views keep rendering unchanged. Missing key → the bare key (a
 * visible "untranslated" signal, never a blank). Pure, so it's unit-testable and
 * shared by the app shell (which holds `labels` directly) and the connected
 * blocks (via `usePackLabelString`).
 */
export function resolvePackLabel(
  value: string | undefined,
  labels: Record<string, string>,
): string | undefined {
  if (value === undefined) return undefined;
  if (!value.startsWith('$label:')) return value;
  const key = value.slice('$label:'.length);
  return labels[key] ?? key;
}

/**
 * Hook form of `resolvePackLabel` for connected registry blocks (which render
 * inside `<Render>` and read the catalog from context). Degrades to `{}` outside
 * a provider — like `usePackLabel`, a block must render its literal rather than
 * crash.
 */
export function usePackLabelString(): (
  value: string | undefined,
) => string | undefined {
  const rt = useContext(AppRuntimeContext);
  return (value) => resolvePackLabel(value, rt?.labels ?? {});
}

/**
 * Resolve a `{ column: label }` map (each label a `$label:` reference or literal)
 * through a `usePackLabelString` resolver, dropping entries that resolve away.
 * Pure (the resolver is injected) so list blocks share one rule and it's
 * unit-testable. Returns `undefined` when there's nothing to resolve, so a block
 * can pass it straight to `DataTable` (header falls back to the column key).
 */
export function resolveColumnLabels(
  columnLabels: Record<string, string> | undefined,
  resolve: (value: string | undefined) => string | undefined,
): Record<string, string> | undefined {
  if (!columnLabels) return undefined;
  const out: Record<string, string> = {};
  for (const [column, label] of Object.entries(columnLabels)) {
    const resolved = resolve(label);
    if (resolved !== undefined) out[column] = resolved;
  }
  return out;
}
