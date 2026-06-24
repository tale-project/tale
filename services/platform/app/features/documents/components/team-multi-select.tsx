'use client';

import { useMemo } from 'react';

import { MultiSelect } from '@/app/components/ui/forms/multi-select';
import { useT } from '@/lib/i18n/client';

interface Team {
  id: string;
  name: string;
}

interface TeamMultiSelectProps {
  teams: Team[];
  selectedTeamIds: string[];
  onSelectionChange: (teamIds: string[]) => void;
  orgWideLabel: string;
  disabled?: boolean;
}

/**
 * Team picker for document / project / agent sharing. A thin wrapper over the
 * shared {@link MultiSelect} primitive: it adapts the `{ id, name }` team shape
 * to options and renders the "org-wide" implicit-default chip as the empty
 * placeholder. The popover gains search + scroll for free, so the same control
 * scales from a handful of teams to hundreds.
 */
export function TeamMultiSelect({
  teams,
  selectedTeamIds,
  onSelectionChange,
  orgWideLabel,
  disabled,
}: TeamMultiSelectProps) {
  const { t } = useT('common');

  const options = useMemo(
    () => teams.map((team) => ({ value: team.id, label: team.name })),
    [teams],
  );

  return (
    <MultiSelect
      value={selectedTeamIds}
      onValueChange={onSelectionChange}
      options={options}
      disabled={disabled || teams.length === 0}
      placeholder={
        <span className="bg-muted inline-flex items-center rounded px-2 py-0.5 text-xs font-medium">
          {orgWideLabel}
        </span>
      }
      searchPlaceholder={t('search.placeholder')}
      emptyText={t('search.noResults')}
    />
  );
}
