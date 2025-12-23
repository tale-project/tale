import { Suspense } from 'react';
import { getCurrentUser, getAuthToken } from '@/lib/auth/auth-server';
import { redirect } from 'next/navigation';
import { fetchQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import OrganizationForm from './organization-form';
import { TaleLogo } from '@/components/tale-logo';
import { UserButton } from '@/components/auth/user-button';
import Link from 'next/link';
import { FormSkeleton } from '@/components/skeletons';

async function CreateBusinessContent() {
  const user = await getCurrentUser();

  if (!user || !user.email) {
    redirect('/log-in');
  }

  const token = await getAuthToken();
  if (!token) {
    redirect('/log-in');
  }

  // Check if user is already a member of an organization
  const organizationId = await fetchQuery(
    api.organizations.currentOrganization,
    {},
    { token },
  );

  // If user has an organization membership, redirect to that organization
  if (organizationId) {
    redirect(`/dashboard/${organizationId}`);
  }

  return (
    <div>
      <div className="pt-8 px-4 sm:px-8 md:px-20 pb-16 md:pb-32">
        <div className="flex items-center justify-between">
          <Link href="/" className="group-hover:opacity-70">
            <TaleLogo />
          </Link>
          <UserButton align="end" />
        </div>
      </div>
      <OrganizationForm />
    </div>
  );
}

/** Skeleton for the create organization form */
function CreateOrganizationSkeleton() {
  return (
    <div>
      <div className="pt-8 px-4 sm:px-8 md:px-20 pb-16 md:pb-32">
        <div className="flex items-center justify-between">
          <TaleLogo />
        </div>
      </div>
      <div className="max-w-md mx-auto px-4">
        <FormSkeleton fields={3} />
      </div>
    </div>
  );
}

export default function CreateBusinessPage() {
  return (
    <Suspense fallback={<CreateOrganizationSkeleton />}>
      <CreateBusinessContent />
    </Suspense>
  );
}
