'use client';

import { Skeleton } from '@tale/ui/skeleton';

import {
  SettingsFieldSkeleton,
  SettingsPageSkeleton,
  SettingsSectionSkeleton,
  SettingsSwitchRowSkeleton,
} from '@/app/features/settings/components/settings-skeleton';

/**
 * Mirrors `<AccountForm>`: Profile (display name input + read-only email) +
 * Security (single button-shaped trigger) + Two-factor (switch row).
 */
export function AccountPageSkeleton() {
  return (
    <SettingsPageSkeleton>
      <SettingsSectionSkeleton>
        <SettingsFieldSkeleton width="sm" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="h-5 w-48" />
        </div>
      </SettingsSectionSkeleton>
      <SettingsSectionSkeleton>
        <Skeleton className="h-9 w-40" />
      </SettingsSectionSkeleton>
      <SettingsSectionSkeleton>
        <SettingsSwitchRowSkeleton />
      </SettingsSectionSkeleton>
    </SettingsPageSkeleton>
  );
}
