import { Skeleton } from '@tale/ui/skeleton';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ContentArea } from '@/app/components/layout/content-area';
import { CheckboxGroup } from '@/app/components/ui/forms/checkbox-group';
import { Stack } from '@/app/components/ui/layout/layout';
import { StickySectionHeader } from '@/app/components/ui/layout/sticky-section-header';
import { Text } from '@/app/components/ui/typography/text';
import { useAgentConfig } from '@/app/features/agents/hooks/use-agent-config-context';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';
import type { AgentI18nOverrides } from '@/convex/agents/file_utils';
import { useT } from '@/lib/i18n/client';
import { resolveAgentLocale } from '@/lib/shared/utils/resolve-agent-locale';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute(
  '/dashboard/$id/agents/$agentId/delegation',
)({
  head: () => ({
    meta: seo('agentDelegation'),
  }),
  component: DelegationTab,
});

interface AgentListEntry {
  name: string;
  displayName?: string;
  description?: string;
  i18n?: Record<string, AgentI18nOverrides>;
}

function DelegationTab() {
  const { t } = useT('settings');
  const { config, updateConfig, agentName } = useAgentConfig();
  const { i18n: i18nCtx } = useTranslation();
  const locale = i18nCtx.language;

  const listAgentsAction = useConvexAction(api.agents.file_actions.listAgents);
  const listAgentsRef = useRef(listAgentsAction);
  listAgentsRef.current = listAgentsAction;

  const [availableAgents, setAvailableAgents] = useState<AgentListEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      try {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex action returns AgentListEntry[] but typed as any
        const agents = (await listAgentsRef.current.mutateAsync({
          orgSlug: 'default',
        })) as AgentListEntry[];
        if (!cancelled) {
          // Skip self + entries that carry an error shape (have `status` but no
          // config fields). `displayName` absence is no longer a signal, since
          // i18n-first agents keep their names under `i18n[locale].displayName`.
          setAvailableAgents(
            agents.filter((a) => a.name !== agentName && !('status' in a)),
          );
        }
      } catch {
        // Silently handle — empty list shown
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentName]);

  const delegateOptions = useMemo(
    () =>
      availableAgents.map((a) => {
        const resolved = resolveAgentLocale(a, locale);
        return {
          value: a.name,
          label: resolved.displayName || a.name,
          description: resolved.description,
        };
      }),
    [availableAgents, locale],
  );

  const selectedValues = config.delegates ?? [];

  return (
    <ContentArea variant="narrow" gap={6}>
      <StickySectionHeader
        title={t('agents.delegation.title')}
        description={t('agents.delegation.description')}
      />

      {isLoading ? (
        <Stack gap={2}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </Stack>
      ) : availableAgents.length === 0 ? (
        <Text variant="muted" className="italic">
          {t('agents.delegation.noDelegatesAvailable')}
        </Text>
      ) : (
        <CheckboxGroup
          options={delegateOptions}
          value={selectedValues}
          onValueChange={(delegates) => updateConfig({ delegates })}
          columns={1}
        />
      )}
    </ContentArea>
  );
}
