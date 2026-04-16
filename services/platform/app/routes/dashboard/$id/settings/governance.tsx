import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { type ReactNode, useMemo } from 'react';
import { z } from 'zod';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Tabs } from '@/app/components/ui/navigation/tabs';
import { BudgetEditor } from '@/app/features/settings/governance/components/budget-editor';
import { FeatureFlagsEditor } from '@/app/features/settings/governance/components/feature-flags-editor';
import { ModelAccessEditor } from '@/app/features/settings/governance/components/model-access-editor';
import { PiiConfig } from '@/app/features/settings/governance/components/pii-config';
import { RetentionEditor } from '@/app/features/settings/governance/components/retention-editor';
import { SystemPromptEditor } from '@/app/features/settings/governance/components/system-prompt-editor';
import { UsageDashboard } from '@/app/features/settings/governance/components/usage-dashboard';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { lazyComponent } from '@/lib/utils/lazy-component';
import { seo } from '@/lib/utils/seo';

const DefaultModelEditor = lazyComponent<{ organizationId: string }>(() =>
  import('@/app/features/settings/governance/components/default-model-editor').then(
    (m) => ({ default: m.DefaultModelEditor }),
  ),
);

const UploadPolicyEditor = lazyComponent(() =>
  import('@/app/features/settings/governance/components/upload-policy-editor').then(
    (m) => ({ default: m.UploadPolicyEditor }),
  ),
);

const LoginPolicyEditor = lazyComponent(() =>
  import('@/app/features/settings/governance/components/login-policy-editor').then(
    (m) => ({ default: m.LoginPolicyEditor }),
  ),
);

const PasswordPolicyEditor = lazyComponent(() =>
  import('@/app/features/settings/governance/components/password-policy-editor').then(
    (m) => ({ default: m.PasswordPolicyEditor }),
  ),
);

const GROUPS = [
  'content-models',
  'policies-limits',
  'security-monitoring',
] as const;
type GroupKey = (typeof GROUPS)[number];

const searchSchema = z.object({
  group: z.enum(GROUPS).optional(),
});

export const Route = createFileRoute('/dashboard/$id/settings/governance')({
  head: () => ({
    meta: seo('governance'),
  }),
  validateSearch: searchSchema,
  component: GovernanceSettingsPage,
});

interface GroupConfig {
  key: GroupKey;
  label: string;
  sections: ReactNode[];
}

function GovernanceSettingsPage() {
  const { id: organizationId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { t: tAccessDenied } = useT('accessDenied');
  const { t } = useT('governance');

  const ability = useAbility();
  const abilityLoading = useAbilityLoading();

  const groups: GroupConfig[] = useMemo(
    () => [
      {
        key: 'content-models',
        label: t('groups.contentAndModels'),
        sections: [
          <Tabs
            key="content-tabs"
            defaultValue="system-prompt"
            items={[
              {
                value: 'system-prompt',
                label: t('groups.subtabs.systemPrompt'),
                content: <SystemPromptEditor organizationId={organizationId} />,
              },
              {
                value: 'default-models',
                label: t('groups.subtabs.defaultModels'),
                content: <DefaultModelEditor organizationId={organizationId} />,
              },
              {
                value: 'model-access',
                label: t('groups.subtabs.modelAccess'),
                content: <ModelAccessEditor organizationId={organizationId} />,
              },
            ]}
          />,
        ],
      },
      {
        key: 'policies-limits',
        label: t('groups.policiesAndLimits'),
        sections: [
          <Tabs
            key="policies-tabs"
            defaultValue="budgets"
            items={[
              {
                value: 'budgets',
                label: t('groups.subtabs.budgets'),
                content: <BudgetEditor organizationId={organizationId} />,
              },
              {
                value: 'upload-policy',
                label: t('groups.subtabs.uploadPolicy'),
                content: <UploadPolicyEditor organizationId={organizationId} />,
              },
              {
                value: 'retention',
                label: t('groups.subtabs.retention'),
                content: <RetentionEditor organizationId={organizationId} />,
              },
              {
                value: 'feature-controls',
                label: t('groups.subtabs.featureControls'),
                content: <FeatureFlagsEditor organizationId={organizationId} />,
              },
            ]}
          />,
        ],
      },
      {
        key: 'security-monitoring',
        label: t('groups.securityAndMonitoring'),
        sections: [
          <Tabs
            key="security-tabs"
            defaultValue="login"
            items={[
              {
                value: 'login',
                label: t('groups.subtabs.login'),
                content: <LoginPolicyEditor organizationId={organizationId} />,
              },
              {
                value: 'password',
                label: t('groups.subtabs.password'),
                content: (
                  <PasswordPolicyEditor organizationId={organizationId} />
                ),
              },
              {
                value: 'pii',
                label: t('groups.subtabs.pii'),
                content: <PiiConfig organizationId={organizationId} />,
              },
              {
                value: 'usage',
                label: t('groups.subtabs.usage'),
                content: <UsageDashboard organizationId={organizationId} />,
              },
            ]}
          />,
        ],
      },
    ],
    [organizationId, t],
  );

  const activeGroup = search.group ?? 'content-models';
  const currentGroup = groups.find((g) => g.key === activeGroup) ?? groups[0];

  const handleGroupChange = (group: GroupKey) => {
    void navigate({
      from: Route.fullPath,
      search: { group },
      replace: true,
    });
  };

  if (abilityLoading) {
    return (
      <div className="flex gap-6">
        <div className="w-[16rem] shrink-0 space-y-2">
          <Skeleton className="h-9 w-full rounded-md" />
          <Skeleton className="h-9 w-full rounded-md" />
          <Skeleton className="h-9 w-full rounded-md" />
        </div>
        <div className="flex-1 space-y-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    );
  }

  if (ability.cannot('read', 'orgSettings')) {
    return <AccessDenied message={tAccessDenied('organization')} />;
  }

  return (
    <div className="flex gap-6">
      <nav className="sticky top-30 flex w-[16rem] shrink-0 flex-col gap-1 self-start">
        {groups.map((group) => (
          <button
            key={group.key}
            type="button"
            onClick={() => handleGroupChange(group.key)}
            className={cn(
              'rounded-md px-3 py-2 text-left text-sm font-medium transition-colors',
              activeGroup === group.key
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
            )}
          >
            {group.label}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1">
        <div className="divide-border flex flex-col divide-y">
          {currentGroup.sections.map((section, i) => (
            <div key={i} className={cn(i > 0 && 'pt-8', 'pb-8')}>
              {section}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
