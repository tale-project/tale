import { createFileRoute } from '@tanstack/react-router';
import { useMemo } from 'react';
import { z } from 'zod';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { Card } from '@/app/components/ui/layout/card';
import { Stack } from '@/app/components/ui/layout/layout';
import { Tabs } from '@/app/components/ui/navigation/tabs';
import { Text } from '@/app/components/ui/typography/text';
import { AuditLogTable } from '@/app/features/settings/audit-logs/components/audit-log-table';
import { useListAuditLogsPaginated } from '@/app/features/settings/audit-logs/hooks/queries';
import { useAbility } from '@/app/hooks/use-ability';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
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

  if (ability.cannot('read', 'orgSettings')) {
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
                  isAdmin={isAdminUser}
                  userEmailMap={userEmailMap}
                />
              </Card>
            ),
          },
          {
            value: 'activity',
            label: t('logs.activityLogs'),
            content: (
              <Card title={t('logs.activityLogs')}>
                <Text variant="muted">{t('logs.activityDescription')}</Text>
              </Card>
            ),
          },
          {
            value: 'errors',
            label: t('logs.errorLogs'),
            content: (
              <Card title={t('logs.errorLogs')}>
                <Text variant="muted">{t('logs.errorDescription')}</Text>
              </Card>
            ),
          },
        ]}
      />
    </Stack>
  );
}
