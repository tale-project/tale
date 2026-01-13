import { Suspense } from 'react';
import { getCurrentUser, getAuthToken } from '@/lib/auth/auth-server';
import { redirect } from 'next/navigation';
import { fetchQuery } from '@/lib/convex-next-server';
import { api } from '@/convex/_generated/api';
import { OrganizationForm } from './components/organization-form';
import { TaleLogo } from '@/components/ui/logo/tale-logo';
import { LogoLink } from '@/components/ui/logo/logo-link';
import { UserButton } from '@/components/user-button';
import { Skeleton } from '@/components/ui/feedback/skeleton';
import { Center, VStack, Stack, HStack, Spacer } from '@/components/ui/layout/layout';
import { getT } from '@/lib/i18n/server';
import type { Metadata } from 'next';

// This page requires authentication (cookies/connection), so it must be dynamic
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('metadata');
  return {
    title: t('createOrganization.title'),
    description: t('createOrganization.description'),
  };
}

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
      <HStack className="pt-8 px-4 sm:px-8 md:px-20 pb-16 md:pb-32">
        <LogoLink href="/" />
        <Spacer />
        <UserButton align="end" />
      </HStack>
      <OrganizationForm />
    </div>
  );
}

/** Skeleton for the create organization form */
function CreateOrganizationSkeleton() {
  return (
    <div>
      <HStack className="pt-8 px-4 sm:px-8 md:px-20 pb-16 md:pb-32">
        <TaleLogo />
      </HStack>
      <Center className="p-4">
        <VStack className="w-full max-w-[24rem]">
          {/* Title */}
          <Skeleton className="h-6 w-48 mx-auto mb-8" />
          {/* Form */}
          <Stack gap={4} className="w-full">
            {/* Input field */}
            <Stack gap={2}>
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-9 w-full rounded-md" />
            </Stack>
            {/* Submit button */}
            <Skeleton className="h-9 w-full rounded-md" />
          </Stack>
        </VStack>
      </Center>
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
