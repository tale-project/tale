import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { AccountFormClient } from '@/app/features/settings/account/components/account-form-client';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Stack, HStack } from '@/app/components/ui/layout/layout';

export const Route = createFileRoute('/dashboard/$id/settings/account')({
  component: AccountPage,
});

function AccountSkeleton() {
  return (
    <Stack gap={4}>
      <Stack gap={2}>
        <Skeleton className="h-5 w-24" />
        <HStack gap={3}>
          <Skeleton className="h-9 flex-1 max-w-sm" />
          <Skeleton className="h-9 w-20" />
        </HStack>
      </Stack>
      <Stack gap={2}>
        <Skeleton className="h-5 w-20" />
        <HStack gap={3}>
          <Skeleton className="h-9 flex-1 max-w-sm" />
          <Skeleton className="h-9 w-20" />
        </HStack>
      </Stack>
    </Stack>
  );
}

function AccountPage() {
  const { id: organizationId } = Route.useParams();
  const memberContext = useQuery(api.queries.member.getCurrentMemberContext, {
    organizationId,
  });

  if (memberContext === undefined) {
    return <AccountSkeleton />;
  }

  return (
    <AccountFormClient
      organizationId={organizationId}
      memberContext={memberContext}
    />
  );
}
