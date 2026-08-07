'use client';

import { Button } from '@tale/ui/button';
import { DropdownMenu } from '@tale/ui/dropdown-menu';
import { Tabs } from '@tale/ui/tabs';
import { ChevronDown, Download } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { DataTableFilters } from '@/app/components/ui/data-table/data-table-filters';
import { ActivityLogView } from '@/app/features/settings/audit-logs/components/activity-log-view';
import { AuditIntegrityPanel } from '@/app/features/settings/audit-logs/components/audit-integrity-panel';
import { AuditLogTab } from '@/app/features/settings/audit-logs/components/audit-log-tab';
import { BlockCountersTable } from '@/app/features/settings/audit-logs/components/block-counters-table';
import { ErrorLogTable } from '@/app/features/settings/audit-logs/components/error-log-table';
import { LogsTableBoundary } from '@/app/features/settings/audit-logs/components/logs-table-boundary';
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
  /**
   * `logId` from the URL (a notification deep link). When present, the audit
   * table reveals that row's detail dialog on the default Audit tab (#1845).
   */
  revealLogId?: string;
}

export function AuditLogsPage({
  organizationId,
  category,
  onCategoryChange,
  tab,
  onTabChange,
  revealLogId,
}: AuditLogsPageProps) {
  const { t } = useT('settings');
  const { t: tAccess } = useT('accessDenied');

  const ability = useAbility();
  const abilityLoading = useAbilityLoading();
  const memberContext = useCurrentMemberContext(organizationId);
  const memberRole = memberContext.data?.role;
  const isAdminUser = memberRole === 'admin' || memberRole === 'owner';

  // A "reveal request" for the audit table's detail dialog: the URL `logId`
  // (notification deep link) and the integrity panel's "open broken row" button
  // both feed it. The bumping `seq` re-triggers the reveal even for the same
  // `logId` (so re-clicking "open row" after closing the dialog reopens it).
  const [reveal, setReveal] = useState<{ logId: string; seq: number } | null>(
    null,
  );
  const requestReveal = useCallback((logId: string) => {
    setReveal((prev) => ({ logId, seq: (prev?.seq ?? 0) + 1 }));
  }, []);
  useEffect(() => {
    if (revealLogId) requestReveal(revealLogId);
  }, [revealLogId, requestReveal]);

  // Tabs are driven controlled off the URL `tab` key (default "audit"). The
  // category filter only feeds the audit + errors queries, so it's a no-op on
  // the "Block counters" and "Activity logs" tabs — render it only where it
  // actually filters something.
  const activeTab = tab ?? 'audit';
  const showCategoryFilter = activeTab === 'audit' || activeTab === 'errors';

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
            value: 'connector',
            label: t('logs.audit.categories.connector'),
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
    errorToast: false,
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

  // Rendered in a filter bar's `actions` slot on every tab (the page toolbar
  // here, the activity view's own bar there) so it always shares the filter
  // button's baseline.
  const exportControl = isAdminUser ? (
    <DropdownMenu
      align="end"
      trigger={
        <Button
          variant="secondary"
          icon={Download}
          disabled={exportAction.isPending}
          aria-label={t('logs.audit.export.triggerLabel')}
        >
          {exportAction.isPending
            ? t('logs.audit.export.inProgress')
            : t('logs.audit.export.label')}
          <ChevronDown className="ml-2 size-4" aria-hidden="true" />
        </Button>
      }
      items={[
        [
          {
            type: 'item',
            label: t('logs.audit.export.csv'),
            icon: Download,
            onClick: () => handleExport('csv'),
          },
          {
            type: 'item',
            label: t('logs.audit.export.json'),
            icon: Download,
            onClick: () => handleExport('json'),
          },
        ],
      ]}
    />
  ) : undefined;

  return (
    // `fullWidth`: the audit/error log columns declare an explicit ~1280px
    // size floor (timestamp/action/actor/resource/target/category/error) —
    // wider than the `max-w-3xl` other settings pages standardized on
    // (#2567) — so this table keeps the full settings pane width.
    <SettingsPage fitToContainer fullWidth>
      <SettingsSection
        title={t('logs.heading')}
        description={t('logs.subheading')}
        className="min-h-0 flex-1"
      >
        {isAdminUser && (
          <AuditIntegrityPanel
            organizationId={organizationId}
            onOpenRow={requestReveal}
          />
        )}
        <Tabs
          value={activeTab}
          onValueChange={onTabChange}
          className="flex min-h-0 flex-1 flex-col"
          // Per-view controls live under the strip, not on it: the filter
          // opens the view's data, so it reads from the left; export acts on
          // it, so it sits right — in the filter bar's actions slot, which is
          // what keeps both on one baseline. The activity tab renders no
          // toolbar here: its own filter bar (inside the view) hosts the
          // export control so the pair shares a row there too.
          toolbar={
            activeTab === 'activity' ? undefined : (
              <DataTableFilters
                {...(showCategoryFilter && {
                  filters: auditFilterConfigs,
                  onClearAll: handleClearFilters,
                })}
                actions={exportControl}
              />
            )
          }
          items={[
            {
              value: 'audit',
              label: t('logs.auditLogs'),
              content: (
                <LogsTableBoundary resetKeys={[category]}>
                  <AuditLogTab
                    organizationId={organizationId}
                    category={category}
                    userEmailMap={userEmailMap}
                    revealLogId={reveal?.logId}
                    revealNonce={reveal?.seq}
                  />
                </LogsTableBoundary>
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
                  actions={exportControl}
                />
              ),
            },
            {
              value: 'errors',
              label: t('logs.errorLogs'),
              content: (
                <LogsTableBoundary variant="errors" resetKeys={[category]}>
                  <ErrorLogTable
                    organizationId={organizationId}
                    category={category}
                    userEmailMap={userEmailMap}
                  />
                </LogsTableBoundary>
              ),
            },
          ]}
        />
      </SettingsSection>
    </SettingsPage>
  );
}
