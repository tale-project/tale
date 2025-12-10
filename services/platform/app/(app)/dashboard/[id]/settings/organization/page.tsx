import { SuspenseLoader } from '@/components/suspense-loader';
import { fetchQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import OrganizationSettings from './components/organization-settings';
import { notFound, redirect } from 'next/navigation';

import { getAuthToken } from '@/lib/auth/auth-server';

interface OrganizationSettingsPageProps {
  params: Promise<{ id: string }>;
}

async function OrganizationSettingsPageContent({
  params,
}: OrganizationSettingsPageProps) {
  const { id } = await params;

  const token = await getAuthToken();
  if (!token) {
    redirect('/log-in');
  }

  // Check user's role in the organization
  const memberContext = await fetchQuery(
    api.member.getCurrentMemberContext,
    {
      organizationId: id as string,
    },
    { token },
  );

  // Only Admin can access organization settings
  if (!memberContext.isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
        <h1 className="text-2xl font-semibold text-foreground mb-2">
          Access Denied
        </h1>
        <p className="text-muted-foreground">
          You need Admin permissions to access organization settings.
        </p>
      </div>
    );
  }

  const organization = await fetchQuery(
    api.organizations.getOrganization,
    {
      id: id as string,
    },
    { token },
  );

  if (!organization) {
    return notFound();
  }

  return <OrganizationSettings organization={organization} />;
}

export default function OrganizationSettingsPage(
  props: OrganizationSettingsPageProps,
) {
  return (
    <SuspenseLoader>
      <OrganizationSettingsPageContent {...props} />
    </SuspenseLoader>
  );
}
