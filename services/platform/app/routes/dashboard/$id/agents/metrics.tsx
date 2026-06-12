import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';
import { z } from 'zod';

import { Select } from '@/app/components/ui/forms/select';
import type { PeriodDays } from '@/app/features/agents/workforce/workforce-dashboard';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { lazyComponent } from '@/lib/utils/lazy-component';
import { seo } from '@/lib/utils/seo';

const WorkforceDashboard = lazyComponent(() =>
  import('@/app/features/agents/workforce/workforce-dashboard').then((mod) => ({
    default: mod.WorkforceDashboard,
  })),
);

const searchSchema = z.object({
  period: z.enum(['7', '30', '90']).optional(),
});

export const Route = createFileRoute('/dashboard/$id/agents/metrics')({
  head: () => ({
    meta: seo('agents'),
  }),
  validateSearch: searchSchema,
  // Warm the Recharts chunk during the loader (it's heavy).
  loader: () => {
    void import('@/app/features/agents/workforce/workforce-dashboard');
  },
  component: AgentsMetricsPage,
});

/**
 * Same page shape as the automations Metrics page: the agents layout's
 * breadcrumb ("Agents › Workforce") is the way back, so the content opens
 * with a plain title block plus the period switcher instead of a
 * PageHeader + back button.
 */
function AgentsMetricsPage() {
  const { id: organizationId } = Route.useParams();
  const { period } = Route.useSearch();
  const navigate = useNavigate();
  const { t } = useT('workforce');
  const ability = useAbility();
  const canToggle = ability.can('read', 'orgSettings');

  const periodDays: PeriodDays = period === '7' ? 7 : period === '90' ? 90 : 30;

  const periodOptions = useMemo(
    () => [
      { value: '7', label: t('period.last7Days') },
      { value: '30', label: t('period.last30Days') },
      { value: '90', label: t('period.last90Days') },
    ],
    [t],
  );

  const handleChangePeriod = useCallback(
    (next: PeriodDays) => {
      const periodParam: '7' | '30' | '90' =
        next === 7 ? '7' : next === 90 ? '90' : '30';
      void navigate({
        to: '/dashboard/$id/agents/metrics',
        params: { id: organizationId },
        search: { period: periodParam },
        replace: true,
      });
    },
    [navigate, organizationId],
  );

  return (
    <Stack gap={6} className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-base font-semibold">{t('title')}</h1>
          <Text variant="caption" className="text-muted-foreground text-sm">
            {t('subtitle')}
          </Text>
        </div>
        <div className="w-44 shrink-0">
          <Select
            options={periodOptions}
            value={String(periodDays)}
            onValueChange={(v) => {
              const next = Number(v);
              if (next === 7 || next === 30 || next === 90)
                handleChangePeriod(next);
            }}
            size="sm"
          />
        </div>
      </div>
      <WorkforceDashboard
        organizationId={organizationId}
        canToggle={canToggle}
        periodDays={periodDays}
      />
    </Stack>
  );
}
