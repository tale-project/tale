'use client';

/**
 * Runtime context for a rendered automation: the current org, the automation slug, and the
 * automation's capability allowlist (`capabilities.functions`). Connected registry
 * blocks read this to bind to Convex functions, gated by the allowlist. Wraps
 * the Puck `<Render>` in `automation-page.tsx`.
 *
 * Display strings in view documents are LITERALS rendered verbatim — the
 * per-bundle label catalog (`$label:` refs, `AutomationRuntime.labels`) is retired;
 * UI translations are platform-owned. A bound action's `labelKey` resolves
 * against the platform `automations` catalog in the block itself
 * (`bound-button.tsx` et al.), never through this context.
 */
import { createContext, useContext } from 'react';

import type { FunctionBinding } from '@/lib/shared/platform/function_bindings';

export interface AutomationRuntime {
  organizationId: string;
  /**
   * Bound project for a `scope: 'project'` automation — the project its data and entry
   * point live under. Undefined for org-scoped automations. Feeds the `$projectId`
   * binding sentinel in view calls.
   */
  projectId?: string;
  /**
   * Display name of the bound project. Feeds `$projectName` (e.g. Form
   * `initial` prefill). Undefined until the project query resolves, or when
   * no project is bound.
   */
  projectName?: string;
  automationSlug: string;
  /** The automation's declared function allowlist (capabilities.functions). */
  allowlist: FunctionBinding[];
  /**
   * The manifest's cast: role token → composite agent slug (`AutomationSummary.roles`,
   * from `manifest.roles`). The `AgentChat` block resolves its `role` prop
   * through this; publish validates `role ∈ manifest.roles`. Absent for automations
   * published before roles existed — blocks degrade to an unavailable state.
   */
  roles?: Record<string, string>;
  /**
   * Reserved for a future per-run/per-project value bag connected blocks could
   * resolve `$config:<key>`/`{key}` templates against. There is no install-time
   * automation config any more (an automation declares only what it REQUIRES; the actual
   * value lives in an integration credential or a workflow's trigger/schedule
   * variables), so nothing currently populates this — it is always empty.
   */
  config?: Record<string, unknown>;
}

const AutomationRuntimeContext = createContext<AutomationRuntime | null>(null);

export function AutomationRuntimeProvider({
  value,
  children,
}: {
  value: AutomationRuntime;
  children: React.ReactNode;
}) {
  return (
    <AutomationRuntimeContext.Provider value={value}>
      {children}
    </AutomationRuntimeContext.Provider>
  );
}

export function useAutomationRuntime(): AutomationRuntime {
  const value = useContext(AutomationRuntimeContext);
  if (!value) {
    throw new Error(
      'useAutomationRuntime must be used within an AutomationRuntimeProvider',
    );
  }
  return value;
}
