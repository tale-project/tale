import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Download } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { z } from 'zod';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { DataTableFilters } from '@/app/components/ui/data-table/data-table-filters';
import { Tabs } from '@/app/components/ui/navigation/tabs';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { AuditLogTable } from '@/app/features/settings/audit-logs/components/audit-log-table';
import { BlockCountersTable } from '@/app/features/settings/audit-logs/components/block-counters-table';
import { useListAuditLogsPaginated } from '@/app/features/settings/audit-logs/hooks/queries';
import { useAbility } from '@/app/hooks/use-ability';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { useToast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

const searchSchema = z.object({
  category: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/settings/logs')({
  head: () => ({
    meta: seo('logs'),
  }),
  validateSearch: searchSchema,
  component: LogsPage,
});

function LogsPage() {
  const { id: organizationId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { t } = useT('settings');
  const { t: tAccess } = useT('accessDenied');

  const ability = useAbility();
  const memberContext = useCurrentMemberContext(organizationId);
  const memberRole = memberContext.data?.role;
  const isAdminUser = memberRole === 'admin' || memberRole === 'owner';

  const paginatedResult = useListAuditLogsPaginated({
    organizationId,
    category: search.category,
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
      void navigate({
        to: '/dashboard/$id/settings/logs',
        params: { id: organizationId },
        search: (prev) => ({
          ...prev,
          category: values[0] || undefined,
        }),
      });
    },
    [navigate, organizationId],
  );

  const handleClearFilters = useCallback(() => {
    void navigate({
      to: '/dashboard/$id/settings/logs',
      params: { id: organizationId },
      search: {},
    });
  }, [navigate, organizationId]);

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
        ],
        selectedValues: search.category ? [search.category] : [],
        onChange: handleCategoryChange,
      },
    ],
    [search.category, t, handleCategoryChange],
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
        filter: search.category ? { category: search.category } : undefined,
      });
    },
    [organizationId, search.category, exportAction],
  );

  if (ability.cannot('read', 'orgSettings')) {
    return <AccessDenied message={tAccess('organization')} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-foreground text-base font-semibold tracking-tight">
            {t('logs.heading')}
          </h1>
          <Text variant="muted" className="text-sm">
            {t('logs.subheading')}
          </Text>
        </div>
        {isAdminUser && (
          <div className="flex items-center gap-2">
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
          </div>
        )}
      </div>
      <Tabs
        defaultValue="audit"
        className="flex min-h-0 flex-1 flex-col"
        actions={
          <DataTableFilters
            filters={auditFilterConfigs}
            onClearAll={handleClearFilters}
          />
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
    </div>
  );
}
