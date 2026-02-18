import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { DataTableSkeleton } from '@/app/components/ui/data-table/data-table-skeleton';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Card } from '@/app/components/ui/layout/card';
import { Stack } from '@/app/components/ui/layout/layout';
import { Tabs } from '@/app/components/ui/navigation/tabs';
import { AuditLogTable } from '@/app/features/settings/audit-logs/components/audit-log-table';
import { useListAuditLogsPaginated } from '@/app/features/settings/audit-logs/hooks/queries';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
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

function LogsSkeleton() {
  const { t } = useT('settings');

  return (
    <Stack gap={4}>
      <div className="bg-muted inline-flex h-10 items-center gap-1 rounded-lg p-1">
        <Skeleton className="h-8 w-24 rounded-md" />
        <Skeleton className="h-8 w-28 rounded-md" />
        <Skeleton className="h-8 w-24 rounded-md" />
      </div>

      <Card title={<Skeleton className="h-6 w-32" />}>
        <DataTableSkeleton
          rows={10}
          columns={[
            { header: t('logs.audit.columns.timestamp'), size: 140 },
            { header: t('logs.audit.columns.action'), size: 160 },
            { header: t('logs.audit.columns.actor'), size: 200 },
            { header: t('logs.audit.columns.resource'), size: 120 },
            { header: t('logs.audit.columns.target'), size: 200 },
            { header: t('logs.audit.columns.category'), size: 100 },
            { header: t('logs.audit.columns.status'), size: 100 },
          ]}
          showHeader
          noFirstColumnAvatar
        />
      </Card>
    </Stack>
  );
}

function LogsPage() {
  const { id: organizationId } = Route.useParams();
  const search = Route.useSearch();
  const { t } = useT('settings');
  const { t: tAccess } = useT('accessDenied');

  const { data: memberContext, isLoading: isMemberLoading } =
    useCurrentMemberContext(organizationId);

  const paginatedResult = useListAuditLogsPaginated({
    organizationId,
    category: search.category,
    initialNumItems: 30,
  });

  if (isMemberLoading) {
    return <LogsSkeleton />;
  }

  if (!memberContext || !memberContext.isAdmin) {
    return <AccessDenied message={tAccess('organization')} />;
  }

  return (
    <Stack gap={4}>
      <Tabs
        defaultValue="audit"
        className="space-y-4"
        items={[
          {
            value: 'audit',
            label: t('logs.auditLogs'),
            content: (
              <Card title={t('logs.auditLogs')}>
                <AuditLogTable
                  organizationId={organizationId}
                  paginatedResult={paginatedResult}
                  category={search.category}
                />
              </Card>
            ),
          },
          {
            value: 'activity',
            label: t('logs.activityLogs'),
            content: (
              <Card title={t('logs.activityLogs')}>
                <p className="text-muted-foreground text-sm">
                  {t('logs.activityDescription')}
                </p>
              </Card>
            ),
          },
          {
            value: 'errors',
            label: t('logs.errorLogs'),
            content: (
              <Card title={t('logs.errorLogs')}>
                <p className="text-muted-foreground text-sm">
                  {t('logs.errorDescription')}
                </p>
              </Card>
            ),
          },
        ]}
      />
    </Stack>
  );
}
