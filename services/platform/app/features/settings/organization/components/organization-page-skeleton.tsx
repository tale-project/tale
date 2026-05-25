'use client';

import {
  SettingsFieldSkeleton,
  SettingsPageSkeleton,
  SettingsRowSkeleton,
  SettingsSectionSkeleton,
} from '@/app/features/settings/components/settings-skeleton';

/**
 * Mirrors `<OrganizationSettings>` (the "General" page): Details (name
 * input + locale select) + Identifiers (org ID copy row).
 */
export function OrganizationPageSkeleton() {
  return (
    <SettingsPageSkeleton>
      <SettingsSectionSkeleton>
        <SettingsFieldSkeleton width="sm" />
        <SettingsFieldSkeleton width="sm" />
      </SettingsSectionSkeleton>
      <SettingsSectionSkeleton>
        <SettingsRowSkeleton controlWidth="w-64" />
      </SettingsSectionSkeleton>
    </SettingsPageSkeleton>
  );
}
