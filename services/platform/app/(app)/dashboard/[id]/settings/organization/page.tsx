import { Suspense } from 'react';
import { fetchQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import OrganizationSettings from './components/organization-settings';
import { notFound, redirect } from 'next/navigation';
import { getAuthToken } from '@/lib/auth/auth-server';
import { Skeleton } from '@/components/ui/skeleton';
import { Stack, HStack } from '@/components/ui/layout';
import { DataTableSkeleton } from '@/components/ui/data-table';
import { AccessDenied } from '@/components/layout';
import { getT } from '@/lib/i18n/server';
import type { Metadata } from 'next';

// This page requires authentication (cookies/connection), so it must be dynamic
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('metadata');
  return {
    title: `${t('organization.title')} | ${t('suffix')}`,
    description: t('organization.description'),
  };
}

interface OrganizationSettingsPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Skeleton for the organization settings page - matches OrganizationSettings layout.
 * Shows organization form section + team members section with table.
 */
async function OrganizationSettingsSkeleton() {
  const { t } = await getT('settings');
  return (
    <Stack>
      <Stack gap={2}>
        <Skeleton className="h-4 w-36" />
        <HStack gap={3} justify="between">
          <Skeleton className="h-10 flex-1 max-w-sm" />
          <Skeleton className="h-10 w-28" />
        </HStack>
      </Stack>

      <Stack className="pt-4">
        <Stack gap={1}>
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-56" />
        </Stack>

        <HStack justify="between">
          <Skeleton className="h-9 w-full max-w-md" />
          <Skeleton className="h-9 w-32" />
        </HStack>

        <DataTableSkeleton
          rows={5}
          columns={[
            { header: t('organization.members.columns.name') },
            { header: t('organization.members.columns.email'), size: 200 },
            { header: t('organization.members.columns.role'), size: 120 },
            { isAction: true, size: 80 },
          ]}
          showHeader
        />
      </Stack>
    </Stack>
  );
}

interface OrganizationSettingsContentProps {
  params: Promise<{ id: string }>;
}

async function OrganizationSettingsPageContent({
  params,
}: OrganizationSettingsContentProps) {
  // All dynamic data access inside Suspense boundary for proper streaming
  const token = await getAuthToken();
  const { id: organizationId } = await params;
  if (!token) {
    redirect('/log-in');
  }

  // Check user's role in the organization
  const memberContext = await fetchQuery(
    api.member.getCurrentMemberContext,
    {
      organizationId,
    },
    { token },
  );

  // Only Admin can access organization settings
  if (!memberContext.isAdmin) {
    const { t } = await getT('accessDenied');
    return (
      <AccessDenied message={t('organization')} />
    );
  }

  const organization = await fetchQuery(
    api.organizations.getOrganization,
    {
      id: organizationId,
    },
    { token },
  );

  if (!organization) {
    return notFound();
  }

  return <OrganizationSettings organization={organization} />;
}

export default function OrganizationSettingsPage({
  params,
}: OrganizationSettingsPageProps) {
  return (
    <Suspense fallback={<OrganizationSettingsSkeleton />}>
      <OrganizationSettingsPageContent params={params} />
    </Suspense>
  );
}
