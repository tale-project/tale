/**
 * Whether the org's Inbox (the conversations surface) is available, and which
 * installed inbox automations feed it.
 *
 * Signal: at least one **deployed** automation declares the `inbox` builtin
 * view on its presentation (seeded from the pack manifest's `builtinViews`).
 * Compose and the channel filter then use each pack's `requiredConnectors`
 * (mail provider first) merged with active credentials.
 */

import { useMemo } from 'react';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import { parseAutomationPresentation } from '@/lib/shared/schemas/automation_presentation';

export interface InboxAutomationSummary {
  slug: string;
  /** The first entry is the inbox provider (gmail / outlook / imap-smtp). */
  requiredConnectors: string[];
}

function presentationRecord(value: unknown): {
  builtinViews?: Array<{ id: string }>;
  requiredConnectors?: string[];
} | null {
  const parsed = parseAutomationPresentation(value);
  if (parsed === null) return null;
  return parsed;
}

export function useInboxAvailability(organizationId: string): {
  isLoading: boolean;
  hasInbox: boolean;
  inboxAutomations: InboxAutomationSummary[];
} {
  const { data, isLoading } = useConvexQuery(
    api.automations.queries.listAutomations,
    organizationId ? { organizationId, includeProjectBound: true } : 'skip',
  );

  const inboxAutomations = useMemo(() => {
    if (!data) return [];
    const out: InboxAutomationSummary[] = [];
    for (const row of data) {
      if (row.deployedVersion === undefined) continue;
      const presentation = presentationRecord(row.presentation);
      const views = presentation?.builtinViews ?? [];
      if (!views.some((view) => view.id === 'inbox')) continue;
      const requiredConnectors = (
        presentation?.requiredConnectors ?? []
      ).filter((slug) => slug !== 'conversation');
      out.push({ slug: row.name, requiredConnectors });
    }
    return out;
  }, [data]);

  return {
    isLoading,
    hasInbox: inboxAutomations.length > 0,
    inboxAutomations,
  };
}
