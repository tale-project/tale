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
 */
export function usePackLabel(): (
  labelKey: string | undefined,
  fallback: string,
) => string {
  const { labels } = useAppRuntime();
  return (labelKey, fallback) => (labelKey && labels[labelKey]) || fallback;
}
