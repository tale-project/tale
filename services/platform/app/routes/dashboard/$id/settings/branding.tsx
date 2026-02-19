import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { BrandingSettingsClient } from '@/app/features/settings/branding/components/branding-settings-client';
import { useBranding } from '@/app/features/settings/branding/hooks/queries';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/branding')({
  head: () => ({
    meta: seo('branding'),
  }),
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      convexQuery(api.branding.queries.getBranding, {
        organizationId: params.id,
      }),
    );
  },
  component: BrandingSettingsPage,
});

function BrandingSettingsSkeleton() {
  return (
    <HStack gap={6} align="start" className="min-h-[500px]">
      <Stack gap={6} className="w-full max-w-sm">
        <Stack gap={2}>
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-9 w-full" />
        </Stack>
        <Stack gap={2}>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-full" />
        </Stack>
        <HStack justify="between">
          <Stack gap={1}>
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-3 w-32" />
          </Stack>
          <Skeleton className="size-10" />
        </HStack>
        <HStack justify="between">
          <Stack gap={1}>
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-3 w-20" />
          </Stack>
          <HStack gap={2}>
            <Skeleton className="size-12" />
            <Skeleton className="size-12" />
          </HStack>
        </HStack>
        <HStack justify="between">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-28" />
        </HStack>
        <HStack justify="between">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-28" />
        </HStack>
      </Stack>
      <Skeleton className="hidden h-[500px] flex-1 rounded-xl lg:block" />
    </HStack>
  );
}

function BrandingSettingsPage() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('accessDenied');

  const { data: memberContext, isLoading: isMemberLoading } =
    useCurrentMemberContext(organizationId);
  const { data: branding, isLoading: isBrandingLoading } =
    useBranding(organizationId);

  if (isMemberLoading || isBrandingLoading || !memberContext) {
    return <BrandingSettingsSkeleton />;
  }

  if (!memberContext.isAdmin) {
    return <AccessDenied message={t('branding')} />;
  }

  return (
    <BrandingSettingsClient
      organizationId={organizationId}
      branding={branding ?? undefined}
    />
  );
}
