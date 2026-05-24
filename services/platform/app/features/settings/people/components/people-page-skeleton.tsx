'use client';

import {
  SettingsPageSkeleton,
  SettingsTableSkeleton,
  SettingsTabsSkeleton,
} from '@/app/features/settings/components/settings-skeleton';

/** Mirrors `<PeopleSettings>`: page header + Tabs strip + members table. */
export function PeoplePageSkeleton() {
  return (
    <SettingsPageSkeleton>
      <div className="flex flex-col gap-4">
        <SettingsTabsSkeleton tabs={2} />
        <SettingsTableSkeleton rows={5} />
      </div>
    </SettingsPageSkeleton>
  );
}
