'use client';

import { Skeleton } from '@tale/ui/skeleton';

import {
  SettingsFieldSkeleton,
  SettingsPageSkeleton,
  SettingsRowSkeleton,
} from '@/app/features/settings/components/settings-skeleton';

/**
 * Mirrors `<BrandingSettings>`: two-column form on the left (4 inputs + 2
 * color-picker rows) with a live preview hidden below `lg`.
 */
export function BrandingPageSkeleton() {
  return (
    <SettingsPageSkeleton>
      <div className="flex flex-1 gap-6">
        <div className="flex w-full max-w-sm flex-col gap-5">
          <SettingsFieldSkeleton width="full" />
          <SettingsFieldSkeleton width="full" />
          <SettingsRowSkeleton controlWidth="w-10" />
          <SettingsRowSkeleton controlWidth="w-24" />
          <SettingsRowSkeleton controlWidth="w-28" />
          <SettingsRowSkeleton controlWidth="w-28" />
        </div>
        <Skeleton className="hidden h-[500px] flex-1 rounded-xl lg:block" />
      </div>
    </SettingsPageSkeleton>
  );
}
