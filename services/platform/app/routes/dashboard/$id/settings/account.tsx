import { createFileRoute } from '@tanstack/react-router';

import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { AccountFormClient } from '@/app/features/settings/account/components/account-form-client';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/account')({
  head: () => ({
    meta: seo('account'),
  }),
  component: AccountPage,
});

function AccountSkeleton() {
  return (
    <Stack gap={4}>
      <Stack gap={2}>
        <Skeleton className="h-5 w-24" />
        <HStack gap={3}>
          <Skeleton className="h-9 max-w-sm flex-1" />
          <Skeleton className="h-9 w-20" />
        </HStack>
      </Stack>
      <Stack gap={2}>
        <Skeleton className="h-5 w-20" />
        <HStack gap={3}>
          <Skeleton className="h-9 max-w-sm flex-1" />
          <Skeleton className="h-9 w-20" />
        </HStack>
      </Stack>
    </Stack>
  );
}

function AccountPage() {
  const { id: organizationId } = Route.useParams();
  const { data: memberContext, isLoading } =
    useCurrentMemberContext(organizationId);

  if (isLoading) {
    return <AccountSkeleton />;
  }

  if (!memberContext) {
    return null;
  }

  return (
    <AccountFormClient
      organizationId={organizationId}
      memberContext={memberContext}
    />
  );
}
