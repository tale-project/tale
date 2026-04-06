import { createFileRoute } from '@tanstack/react-router';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { BrandingSettings } from '@/app/features/settings/branding/components/branding-settings';
import { useBranding } from '@/app/features/settings/branding/hooks/queries';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/branding')({
  head: () => ({
    meta: seo('branding'),
  }),
  component: BrandingSettingsPage,
});

function BrandingSettingsSkeleton() {
  return (
    <HStack gap={6} align="start" className="min-h-[500px]">
      <Stack gap={6} className="w-full max-w-sm">
        <FormSection>
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-9 w-full" />
        </FormSection>
        <FormSection>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-full" />
        </FormSection>
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
  const { t } = useT('accessDenied');

  const ability = useAbility();
  const abilityLoading = useAbilityLoading();

  const {
    data: branding,
    isLoading: isBrandingLoading,
    refetch,
  } = useBranding();

  if (abilityLoading || isBrandingLoading) {
    return <BrandingSettingsSkeleton />;
  }

  if (ability.cannot('read', 'orgSettings')) {
    return <AccessDenied message={t('branding')} />;
  }

  return (
    <BrandingSettings branding={branding ?? undefined} onSaved={refetch} />
  );
}
