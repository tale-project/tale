'use client';

import { Button } from '@tale/ui/button';
import { Row } from '@tale/ui/layout';
import { Tabs } from '@tale/ui/tabs';
import { Download } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { DataTableFilters } from '@/app/components/ui/data-table/data-table-filters';
import { ActivityLogView } from '@/app/features/settings/audit-logs/components/activity-log-view';
import { AuditLogTable } from '@/app/features/settings/audit-logs/components/audit-log-table';
import { BlockCountersTable } from '@/app/features/settings/audit-logs/components/block-counters-table';
import { ErrorLogTable } from '@/app/features/settings/audit-logs/components/error-log-table';
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
  /** Active tab key, sourced from the URL so reload/deep-link/Back restore it. */
  tab?: string;
  onTabChange: (tab: string) => void;
}

export function AuditLogsPage({
  organizationId,
  category,
  onCategoryChange,
  tab,
  onTabChange,
}: AuditLogsPageProps) {
  const { t } = useT('settings');
  const { t: tAccess } = useT('accessDenied');

  const ability = useAbility();
  const abilityLoading = useAbilityLoading();
  const memberContext = useCurrentMemberContext(organizationId);
  const memberRole = memberContext.data?.role;
  const isAdminUser = memberRole === 'admin' || memberRole === 'owner';

  // Tabs are driven controlled off the URL `tab` key (default "audit"). The
  // category filter only feeds the audit + errors queries, so it's a no-op on
  // the "Block counters" and "Activity logs" tabs — render it only where it
  // actually filters something.
  const activeTab = tab ?? 'audit';
  const showCategoryFilter = activeTab === 'audit' || activeTab === 'errors';

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
          value={activeTab}
          onValueChange={onTabChange}
          className="flex min-h-0 flex-1 flex-col"
          actions={
            <Row gap={2}>
              {showCategoryFilter && (
                <DataTableFilters
                  filters={auditFilterConfigs}
                  onClearAll={handleClearFilters}
                />
              )}
              {isAdminUser && (
                <>
                  <Button
                    variant="secondary"
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
            </Row>
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
                <ActivityLogView
                  organizationId={organizationId}
                  userEmailMap={userEmailMap}
                />
              ),
            },
            {
              value: 'errors',
              label: t('logs.errorLogs'),
              content: (
                <ErrorLogTable
                  organizationId={organizationId}
                  category={category}
                  userEmailMap={userEmailMap}
                />
              ),
            },
          ]}
        />
      </SettingsSection>
    </SettingsPage>
  );
}
