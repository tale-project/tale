import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getAuthToken } from '@/lib/auth/auth-server';
import { fetchQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import { Skeleton } from '@/components/ui/feedback/skeleton';
import { Stack, HStack } from '@/components/ui/layout/layout';
import { DataTableSkeleton } from '@/components/ui/data-table/data-table-skeleton';
import { AccessDenied } from '@/components/layout/access-denied';
import { getT } from '@/lib/i18n/server';
import { TeamsSettings } from './components/teams-settings';
import type { Metadata } from 'next';

// This page requires authentication (cookies/connection), so it must be dynamic
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('metadata');
  return {
    title: t('teams.title'),
    description: t('teams.description'),
  };
}

interface TeamsSettingsPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Skeleton for the teams settings page.
 */
async function TeamsSettingsSkeleton() {
  const { t } = await getT('settings');
  return (
    <Stack>
      <Stack gap={1}>
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-64" />
      </Stack>

      <HStack justify="between" className="pt-4">
        <Skeleton className="h-9 w-full max-w-sm" />
        <Skeleton className="h-9 w-32" />
      </HStack>

      <DataTableSkeleton
        rows={5}
        columns={[
          { header: t('teams.columns.name') },
          { header: t('teams.columns.created'), size: 150 },
          { isAction: true, size: 80 },
        ]}
        showHeader
      />
    </Stack>
  );
}

interface TeamsSettingsContentProps {
  params: Promise<{ id: string }>;
}

async function TeamsSettingsPageContent({
  params,
}: TeamsSettingsContentProps) {
  const token = await getAuthToken();
  const { id: organizationId } = await params;
  if (!token) {
    redirect('/log-in');
  }

  // Check if user is admin
  const memberContext = await fetchQuery(
    api.member.getCurrentMemberContext,
    { organizationId },
    { token },
  );

  // Only Admin can access teams settings
  if (!memberContext.isAdmin) {
    const { t } = await getT('accessDenied');
    return <AccessDenied message={t('teams')} />;
  }

  return <TeamsSettings organizationId={organizationId} />;
}

export default function TeamsSettingsPage({
  params,
}: TeamsSettingsPageProps) {
  return (
    <Suspense fallback={<TeamsSettingsSkeleton />}>
      <TeamsSettingsPageContent params={params} />
    </Suspense>
  );
}
