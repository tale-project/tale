'use client';

import {
  SettingsPageSkeleton,
  SettingsRowSkeleton,
  SettingsSectionSkeleton,
  SettingsSwitchRowSkeleton,
  SettingsTextareaFieldSkeleton,
} from '@/app/features/settings/components/settings-skeleton';

/**
 * Mirrors `<PersonalizationSettings>`: enable toggle + custom instructions
 * textarea + voice toggle + saved memories list.
 */
export function PersonalizationPageSkeleton() {
  return (
    <SettingsPageSkeleton>
      <SettingsSectionSkeleton>
        <SettingsSwitchRowSkeleton />
        <SettingsTextareaFieldSkeleton rows={6} />
      </SettingsSectionSkeleton>
      <SettingsSectionSkeleton>
        <SettingsSwitchRowSkeleton />
      </SettingsSectionSkeleton>
      <SettingsSectionSkeleton>
        <SettingsRowSkeleton />
        <SettingsRowSkeleton />
        <SettingsRowSkeleton />
      </SettingsSectionSkeleton>
    </SettingsPageSkeleton>
  );
}
