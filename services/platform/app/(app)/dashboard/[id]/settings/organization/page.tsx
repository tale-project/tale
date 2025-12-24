import { Suspense } from 'react';
import { fetchQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import OrganizationSettings from './components/organization-settings';
import { notFound, redirect } from 'next/navigation';
import { getAuthToken } from '@/lib/auth/auth-server';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTableSkeleton } from '@/components/ui/data-table';
import { AccessDenied } from '@/components/layout';

interface OrganizationSettingsPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Skeleton for the organization settings page - matches OrganizationSettings layout.
 * Shows organization form section + team members section with table.
 */
function OrganizationSettingsSkeleton() {
  return (
    <div className="space-y-4">
      {/* Organization name form */}
      <div className="space-y-2">
        <Skeleton className="h-4 w-36" />
        <div className="flex items-center gap-3 justify-between">
          <Skeleton className="h-10 flex-1 max-w-sm" />
          <Skeleton className="h-10 w-28" />
        </div>
      </div>

      {/* Team members section */}
      <div className="space-y-4 pt-4">
        {/* Title and description */}
        <div className="space-y-1">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-56" />
        </div>

        {/* Search and add member */}
        <div className="flex items-center justify-between gap-4">
          <Skeleton className="h-9 w-full max-w-md" />
          <Skeleton className="h-9 w-32" />
        </div>

        {/* Members table */}
        <DataTableSkeleton
          rows={5}
          columns={[
            { header: 'Name' },
            { header: 'Email', size: 200 },
            { header: 'Role', size: 120 },
            { isAction: true, size: 80 },
          ]}
          showHeader
        />
      </div>
    </div>
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
    return (
      <AccessDenied message="You need Admin permissions to access organization settings." />
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
