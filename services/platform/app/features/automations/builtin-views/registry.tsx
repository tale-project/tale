'use client';

/**
 * The Inbox builtin view — the one platform-rendered view an automation manifest
 * can opt into via `builtinViews: [{ id: 'inbox' }]` (schema:
 * `lib/shared/schemas/automations.ts#automationBuiltinViewSchema`, a closed id
 * enum). Inbox does NOT render as a per-automation tab: it is the org-level
 * `/conversations` page, and `builtinViews` is purely the signal that gates its
 * nav entry (`@/app/hooks/use-navigation-items`, `mobile-bottom-nav.tsx`) and its
 * route guard (`app/routes/dashboard/$id/conversations*`) — see
 * `automationUsesInbox` below.
 *
 * `useBuiltinViewTitles` is the one survivor of the former per-id component
 * registry: the pre-install preview panel (`automation-panel.tsx`) still lists a
 * "Pages" chip for every builtin view an automation brings, so it still needs a
 * label — reused here from the Inbox page's own title (`conversations.title`)
 * instead of a second copy of the same string.
 */
import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';
import type { AutomationBuiltinView } from '@/lib/shared/schemas/automations';

import {
  type AutomationSummary,
  useAutomations,
} from '../hooks/use-automations';
import { useAutomationInstallStates } from '../hooks/use-install-state';

/** Whether an automation declares the Inbox builtin view — the nav-gate signal
 *  for the org-level Inbox entry and the `/conversations` route guard. */
export function automationUsesInbox(
  automation: Pick<AutomationSummary, 'builtinViews'>,
): boolean {
  return automation.builtinViews?.some((view) => view.id === 'inbox') ?? false;
}

/**
 * The org's Inbox availability: the INSTALLED automations that declare the
 * `inbox` builtin view. `useAutomations` alone is NOT the install signal —
 * builtin bundles are seeded into every org dir at create
 * (`lib/shared/config/registry.ts`), so it lists the email automations even on
 * a fresh org; the `automationInstallations` row
 * (`useAutomationInstallStates`, absent = not installed) is the authoritative
 * "installed" bit. `isLoading` covers both reads so gated UI (nav rail,
 * mobile tab, the `/conversations` route guard) hides instead of flashing.
 */
export function useInboxAvailability(organizationId: string): {
  isLoading: boolean;
  /** At least one installed automation declares the inbox builtin view. */
  hasInbox: boolean;
  /** The installed inbox automations — the channel filter derives its
   *  provider options from their `requiredIntegrations`. */
  inboxAutomations: AutomationSummary[];
} {
  const { automations, isLoading: automationsLoading } =
    useAutomations(organizationId);
  const { bySlug, isLoading: statesLoading } =
    useAutomationInstallStates(organizationId);
  const isLoading = automationsLoading || statesLoading;
  const inboxAutomations = useMemo(
    () =>
      isLoading
        ? []
        : automations.filter(
            (automation) =>
              automationUsesInbox(automation) && bySlug.has(automation.slug),
          ),
    [isLoading, automations, bySlug],
  );
  return {
    isLoading,
    hasInbox: inboxAutomations.length > 0,
    inboxAutomations,
  };
}

/** Localized titles for the pre-install "Pages" chips, in manifest order — one
 *  "Inbox" entry per declared builtin view (there is only ever one, today). */
export function useBuiltinViewTitles(
  views: AutomationBuiltinView[] | undefined,
): string[] {
  const { t } = useT('conversations');
  return (views ?? [])
    .filter((view) => view.id === 'inbox')
    .map(() => t('title'));
}
