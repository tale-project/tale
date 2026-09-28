'use client';

import { MultiSelect } from '@tale/ui/multi-select';
import { type ReactNode, useMemo } from 'react';

import { useT } from '@/lib/i18n/client';

interface Team {
  id: string;
  name: string;
}

interface TeamMultiSelectProps {
  teams: Team[];
  selectedTeamIds: string[];
  onSelectionChange: (teamIds: string[]) => void;
  /** Label shown when no teams are selected in the multiselect. */
  orgWideLabel: string;
  /**
   * How the empty-state label renders. `chip` reads as a selected tag (org-wide
   * defaults on documents/agents); `muted` reads as placeholder text when empty
   * means "no additional teams" rather than org-wide access.
   * @default 'chip'
   */
  emptyPlaceholderStyle?: 'chip' | 'muted';
  disabled?: boolean;
  /** Id of the combobox, for a caller that deep-links or focuses it. */
  id?: string;
  /**
   * Visible label above the picker; it names the combobox (a `<label
   * htmlFor>` cannot name a `role="combobox"` div). Pass it — or, when the
   * surrounding layout already shows the words, `aria-labelledby` pointing at
   * them (`aria-label` when they have no id) — never none of the three.
   */
  label?: ReactNode;
  /** Accessible name when no visible `label` is rendered. */
  'aria-label'?: string;
  /** Id of the visible words that name the picker, e.g. a settings row's label. */
  'aria-labelledby'?: string;
  /** Help text under the picker, tied to it as its description. */
  description?: ReactNode;
  /** Id of help text shown elsewhere, e.g. a settings row's description. */
  'aria-describedby'?: string;
}

/**
 * Team picker for document / project / agent sharing. A thin wrapper over the
 * shared {@link MultiSelect} primitive: it adapts the `{ id, name }` team shape
 * to options and renders an empty-state label (chip or muted placeholder).
 * The popover gains search + scroll for free, so the same control scales from a
 * handful of teams to hundreds.
 */
export function TeamMultiSelect({
  teams,
  selectedTeamIds,
  onSelectionChange,
  orgWideLabel,
  emptyPlaceholderStyle = 'chip',
  disabled,
  id,
  label,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  description,
  'aria-describedby': ariaDescribedBy,
}: TeamMultiSelectProps) {
  const { t } = useT('common');

  const options = useMemo(
    () => teams.map((team) => ({ value: team.id, label: team.name })),
    [teams],
  );

  const placeholder =
    emptyPlaceholderStyle === 'muted' ? (
      orgWideLabel
    ) : (
      <span className="bg-muted inline-flex items-center rounded px-2 py-0.5 text-xs font-medium">
        {orgWideLabel}
      </span>
    );

  return (
    <MultiSelect
      id={id}
      label={label}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      description={description}
      aria-describedby={ariaDescribedBy}
      value={selectedTeamIds}
      onValueChange={onSelectionChange}
      options={options}
      disabled={disabled || teams.length === 0}
      placeholder={placeholder}
      searchPlaceholder={t('search.placeholder')}
      emptyText={t('search.noResults')}
      modal
    />
  );
}
