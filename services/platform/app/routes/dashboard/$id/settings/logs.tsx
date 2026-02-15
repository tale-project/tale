import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { DataTableSkeleton } from '@/app/components/ui/data-table/data-table-skeleton';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/app/components/ui/layout/card';
import { Stack } from '@/app/components/ui/layout/layout';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/app/components/ui/navigation/tabs';
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
      <div className="space-y-4">
        <div className="bg-muted inline-flex h-10 items-center gap-1 rounded-lg p-1">
          <Skeleton className="h-8 w-24 rounded-md" />
          <Skeleton className="h-8 w-28 rounded-md" />
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>

        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      </div>
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

  if (paginatedResult.status === 'LoadingFirstPage' && !search.category) {
    return <LogsSkeleton />;
  }

  if (!memberContext || !memberContext.isAdmin) {
    return <AccessDenied message={tAccess('organization')} />;
  }

  return (
    <Stack gap={4}>
      <Tabs defaultValue="audit" className="space-y-4">
        <TabsList>
          <TabsTrigger value="audit">{t('logs.auditLogs')}</TabsTrigger>
          <TabsTrigger value="activity">{t('logs.activityLogs')}</TabsTrigger>
          <TabsTrigger value="errors">{t('logs.errorLogs')}</TabsTrigger>
        </TabsList>

        <TabsContent value="audit">
          <Card>
            <CardHeader>
              <CardTitle>{t('logs.auditLogs')}</CardTitle>
            </CardHeader>
            <CardContent>
              <AuditLogTable
                organizationId={organizationId}
                paginatedResult={paginatedResult}
                category={search.category}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity">
          <Card>
            <CardHeader>
              <CardTitle>{t('logs.activityLogs')}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-sm">
                {t('logs.activityDescription')}
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="errors">
          <Card>
            <CardHeader>
              <CardTitle>{t('logs.errorLogs')}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-sm">
                {t('logs.errorDescription')}
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </Stack>
  );
}
