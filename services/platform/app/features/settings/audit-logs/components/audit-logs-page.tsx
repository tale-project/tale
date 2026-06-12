'use client';

import { Button } from '@tale/ui/button';
import { Tabs } from '@tale/ui/tabs';
import { Text } from '@tale/ui/text';
import { Download } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { DataTableFilters } from '@/app/components/ui/data-table/data-table-filters';
import { AuditLogTable } from '@/app/features/settings/audit-logs/components/audit-log-table';
import { BlockCountersTable } from '@/app/features/settings/audit-logs/components/block-counters-table';
import { useListAuditLogsPaginated } from '@/app/features/settings/audit-logs/hooks/queries';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { useToast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

interface AuditLogsPageProps {
  organizationId: string;
  category?: string;
  onCategoryChange: (category: string | undefined) => void;
}

export function AuditLogsPage({
  organizationId,
  category,
  onCategoryChange,
}: AuditLogsPageProps) {
  const { t } = useT('settings');
  const { t: tAccess } = useT('accessDenied');

  const ability = useAbility();
  const abilityLoading = useAbilityLoading();
  const memberContext = useCurrentMemberContext(organizationId);
  const memberRole = memberContext.data?.role;
  const isAdminUser = memberRole === 'admin' || memberRole === 'owner';

  const paginatedResult = useListAuditLogsPaginated({
    organizationId,
    category,
    initialNumItems: 30,
  });

  const membersQuery = useConvexQuery(api.members.queries.listByOrganization, {
    organizationId,
  });
  const userEmailMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of membersQuery.data ?? []) {
      if (m.email) map.set(m.userId, m.email);
    }
    return map;
  }, [membersQuery.data]);

  const handleCategoryChange = useCallback(
    (values: string[]) => {
      onCategoryChange(values[0] || undefined);
    },
    [onCategoryChange],
  );

  const handleClearFilters = useCallback(() => {
    onCategoryChange(undefined);
  }, [onCategoryChange]);

  const auditFilterConfigs = useMemo(
    () => [
      {
        key: 'category',
        title: t('logs.audit.columns.category'),
        options: [
          { value: 'auth', label: t('logs.audit.categories.auth') },
          { value: 'member', label: t('logs.audit.categories.member') },
          { value: 'data', label: t('logs.audit.categories.data') },
          {
            value: 'integration',
            label: t('logs.audit.categories.integration'),
          },
          { value: 'workflow', label: t('logs.audit.categories.workflow') },
          { value: 'security', label: t('logs.audit.categories.security') },
          { value: 'admin', label: t('logs.audit.categories.admin') },
          { value: 'ai', label: t('logs.audit.categories.ai') },
          { value: 'skill', label: t('logs.audit.categories.skill') },
          { value: 'agent', label: t('logs.audit.categories.agent') },
        ],
        selectedValues: category ? [category] : [],
        onChange: handleCategoryChange,
      },
    ],
    [category, t, handleCategoryChange],
  );

  const { toast } = useToast();

  const exportAction = useConvexAction(api.audit_logs.actions.requestExport, {
    onSuccess: (data) => {
      if (data.url) {
        window.open(data.url, '_blank', 'noopener,noreferrer');
      }
      toast({
        title: t('logs.audit.export.complete'),
        description: data.fileName,
      });
    },
    onError: () => {
      toast({
        title: t('logs.audit.export.error'),
        variant: 'destructive',
      });
    },
  });

  const handleExport = useCallback(
    (format: 'csv' | 'json') => {
      exportAction.mutate({
        organizationId,
        format,
        filter: category ? { category } : undefined,
      });
    },
    [organizationId, category, exportAction],
  );

  // Access is only knowable once the ability has loaded; until then the real
  // page (with its self-skeletonizing DataTable) stands in — no denied-flash on
  // warm entry, and no separate skeleton whose tab strip / column widths could
  // drift from the real pill `Tabs` + `DataTable`.
  if (!abilityLoading && ability.cannot('read', 'orgSettings')) {
    return <AccessDenied message={tAccess('organization')} />;
  }

  return (
    <SettingsPage fitToContainer>
      <SettingsSection
        title={t('logs.heading')}
        description={t('logs.subheading')}
        className="min-h-0 flex-1"
      >
        <Tabs
          defaultValue="audit"
          className="flex min-h-0 flex-1 flex-col"
          actions={
            <div className="flex items-center gap-2">
              <DataTableFilters
                filters={auditFilterConfigs}
                onClearAll={handleClearFilters}
              />
              {isAdminUser && (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={Download}
                    onClick={() => handleExport('csv')}
                    disabled={exportAction.isPending}
                    aria-label={t('logs.audit.export.csvLabel')}
                  >
                    {exportAction.isPending
                      ? t('logs.audit.export.inProgress')
                      : t('logs.audit.export.csv')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={Download}
                    onClick={() => handleExport('json')}
                    disabled={exportAction.isPending}
                    aria-label={t('logs.audit.export.jsonLabel')}
                  >
                    {exportAction.isPending
                      ? t('logs.audit.export.inProgress')
                      : t('logs.audit.export.json')}
                  </Button>
                </>
              )}
            </div>
          }
          items={[
            {
              value: 'audit',
              label: t('logs.auditLogs'),
              content: (
                <AuditLogTable
                  paginatedResult={paginatedResult}
                  userEmailMap={userEmailMap}
                />
              ),
            },
            {
              value: 'blocks',
              label: t('logs.blockCounters.tabLabel'),
              content: <BlockCountersTable organizationId={organizationId} />,
            },
            {
              value: 'activity',
              label: t('logs.activityLogs'),
              content: (
                <Text variant="muted" className="text-sm">
                  {t('logs.activityComingSoon')}
                </Text>
              ),
            },
            {
              value: 'errors',
              label: t('logs.errorLogs'),
              content: (
                <Text variant="muted" className="text-sm">
                  {t('logs.errorComingSoon')}
                </Text>
              ),
            },
          ]}
        />
      </SettingsSection>
    </SettingsPage>
  );
}
