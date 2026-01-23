import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { AccessDenied } from '@/app/components/layout/access-denied';
import { AuditLogTable } from '@/app/features/settings/audit-logs/components/audit-log-table';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/app/components/ui/layout/card';
import { Stack } from '@/app/components/ui/layout/layout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/navigation/tabs';
import { useT } from '@/lib/i18n/client';

export const Route = createFileRoute('/dashboard/$id/settings/logs')({
  component: LogsPage,
});

function LogsSkeleton() {
  return (
    <Stack gap={4}>
      <Skeleton className="h-10 w-80" />
      <Skeleton className="h-96 w-full rounded-xl" />
    </Stack>
  );
}

function LogsPage() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('settings');
  const { t: tAccess } = useT('accessDenied');

  const memberContext = useQuery(api.members.queries.getCurrentMemberContext, {
    organizationId,
  });

  const auditLogs = useQuery(api.audit_logs.queries.listAuditLogs, {
    organizationId,
    limit: 100,
  });

  if (memberContext === undefined || auditLogs === undefined) {
    return <LogsSkeleton />;
  }

  if (memberContext === null || !memberContext.isAdmin) {
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
              <AuditLogTable logs={auditLogs.logs} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity">
          <Card>
            <CardHeader>
              <CardTitle>{t('logs.activityLogs')}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
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
              <p className="text-sm text-muted-foreground">
                {t('logs.errorDescription')}
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </Stack>
  );
}
