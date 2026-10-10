/**
 * Whether the org's Inbox (the conversations surface) is available, and which
 * installed inbox automations feed it.
 *
 * Signal: at least one **deployed** automation declares the `inbox` builtin
 * view on its presentation (seeded from the pack manifest's `builtinViews`).
 * Compose and the channel filter then use each pack's `requiredConnectors`
 * (mail provider first) merged with active credentials.
 */

import { useCallback, useMemo } from 'react';

import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { readStateOf, type ReadState } from '@/app/lib/backend/read-state';
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
  showInbox: boolean;
  readState: ReadState;
  error: unknown;
  retry: () => Promise<unknown>;
  inboxAutomations: InboxAutomationSummary[];
} {
  const automationsQuery = useBackendQuery(
    'automations/queries:listAutomations',
    organizationId ? { organizationId, includeProjectBound: true } : 'skip',
  );
  const sourcesQuery = useBackendQuery(
    'conversations/queries:apiSources',
    organizationId ? { organizationId } : 'skip',
  );
  const { data } = automationsQuery;
  const automationsState = readStateOf(automationsQuery);
  const sourcesState = readStateOf(sourcesQuery);
  const readState: ReadState = {
    unavailable: automationsState.unavailable || sourcesState.unavailable,
    stale: automationsState.stale || sourcesState.stale,
    retrying: automationsState.retrying || sourcesState.retrying,
    failureCount: automationsState.failureCount + sourcesState.failureCount,
  };
  const { refetch: refetchAutomations } = automationsQuery;
  const { refetch: refetchSources } = sourcesQuery;
  const retry = useCallback(
    () => Promise.all([refetchAutomations(), refetchSources()]),
    [refetchAutomations, refetchSources],
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

  const hasInbox =
    inboxAutomations.length > 0 || (sourcesQuery.data?.length ?? 0) > 0;
  const failed = readState.unavailable || readState.stale;
  return {
    isLoading:
      !failed && (automationsQuery.isLoading || sourcesQuery.isLoading),
    hasInbox,
    showInbox: hasInbox || failed,
    readState,
    error: automationsQuery.error ?? sourcesQuery.error,
    retry,
    inboxAutomations,
  };
}
