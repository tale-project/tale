import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';
import { z } from 'zod';

import { AccessDenied } from '@/app/components/layout/access-denied';
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
    <Tabs
      defaultValue="audit"
      className="flex min-h-0 flex-1 flex-col"
      actions={
        isAdminUser ? (
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
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
              onClick={() => handleExport('json')}
              disabled={exportAction.isPending}
              aria-label={t('logs.audit.export.jsonLabel')}
            >
              {exportAction.isPending
                ? t('logs.audit.export.inProgress')
                : t('logs.audit.export.json')}
            </Button>
          </div>
        ) : undefined
      }
      items={[
        {
          value: 'audit',
          label: t('logs.auditLogs'),
          content: (
            <AuditLogTable
              organizationId={organizationId}
              paginatedResult={paginatedResult}
              category={search.category}
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
  );
}
