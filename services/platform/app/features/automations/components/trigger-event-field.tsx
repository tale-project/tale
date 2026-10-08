'use client';

import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@tale/ui/searchable-select';
import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';
import { isEmittedEventType } from '@/lib/shared/event-types';

import {
  EVENT_GROUPS,
  eventGroupLabel,
  eventsOf,
  eventWords,
} from '../lib/event-labels';

/** A row matches its words or its id (`task.created`). */
function matches(option: SearchableSelectOption, query: string): boolean {
  const lower = query.toLowerCase();
  return (
    option.value.toLowerCase().includes(lower) ||
    option.label.toLowerCase().includes(lower) ||
    (option.description?.toLowerCase().includes(lower) ?? false)
  );
}

/**
 * The event an event trigger starts on: the platform's events, grouped by
 * what they are about, each under its name with its id beside it and one
 * sentence of when it is raised — repeated under the field for the picked
 * one.
 */
export function TriggerEventField({
  value,
  onChange,
  canEdit,
  modal,
}: {
  value: string;
  onChange: (event: string) => void;
  canEdit: boolean;
  /** Inside a dialog (the Blank wizard), the list is a modal layer. */
  modal: boolean;
}) {
  const { t } = useT('automations');
  const options = useMemo<SearchableSelectOption[]>(() => {
    const rows: SearchableSelectOption[] = [];
    for (const group of EVENT_GROUPS) {
      rows.push({
        value: `group:${group}`,
        label: eventGroupLabel(group, t),
        isSectionHeader: true,
      });
      for (const type of eventsOf(group)) {
        const words = eventWords(type, t);
        rows.push({
          value: type,
          label: words.label,
          description: words.description,
          labelBadge: (
            <code className="text-muted-foreground font-mono text-xs">
              {type}
            </code>
          ),
          group,
        });
      }
    }
    return rows;
  }, [t]);
  const picked = isEmittedEventType(value) ? eventWords(value, t) : null;

  return (
    <SearchableSelect
      label={t('trigger.eventLabel')}
      placeholder={t('trigger.eventPlaceholder')}
      searchPlaceholder={t('trigger.events.search')}
      emptyText={t('trigger.events.empty')}
      options={options}
      value={value === '' ? null : value}
      onValueChange={onChange}
      filterFn={matches}
      disabled={!canEdit}
      modal={modal}
      {...(picked !== null && { description: picked.description })}
    />
  );
}
