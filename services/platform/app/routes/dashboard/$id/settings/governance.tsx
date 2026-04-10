import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';
import { z } from 'zod';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { Tabs } from '@/app/components/ui/navigation/tabs';
import { BudgetEditor } from '@/app/features/settings/governance/components/budget-editor';
import { SystemPromptEditor } from '@/app/features/settings/governance/components/system-prompt-editor';
import { UsageDashboard } from '@/app/features/settings/governance/components/usage-dashboard';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

const searchSchema = z.object({
  tab: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/settings/governance')({
  head: () => ({
    meta: seo('governance'),
  }),
  validateSearch: searchSchema,
  component: GovernanceSettingsPage,
});

function GovernanceSettingsPage() {
  const { id: organizationId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { t } = useT('accessDenied');

  const ability = useAbility();
  const abilityLoading = useAbilityLoading();

  const activeTab = search.tab ?? 'system-prompt';

  const handleTabChange = (tab: string) => {
    void navigate({
      from: Route.fullPath,
      search: { ...search, tab },
      replace: true,
    });
  };

  const tabItems = useMemo(
    () => [
      {
        value: 'system-prompt',
        label: 'System Prompt',
        content: <SystemPromptEditor organizationId={organizationId} />,
      },
      {
        value: 'budgets',
        label: 'Budgets',
        content: <BudgetEditor organizationId={organizationId} />,
      },
      {
        value: 'usage',
        label: 'Usage',
        content: <UsageDashboard organizationId={organizationId} />,
      },
    ],
    [organizationId],
  );

  if (abilityLoading) {
    return null;
  }

  if (ability.cannot('read', 'orgSettings')) {
    return <AccessDenied message={t('organization')} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <Tabs
        items={tabItems}
        value={activeTab}
        onValueChange={handleTabChange}
      />
    </div>
  );
}
