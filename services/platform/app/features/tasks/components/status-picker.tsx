'use client';

import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/app/components/ui/forms/searchable-select';
import { useT } from '@/lib/i18n/client';

import {
  isTaskStatus,
  TASK_STATUS_ORDER,
  type TaskStatus,
} from '../lib/display';
import { TaskStatusBadge } from './task-status-badge';

/**
 * Inline status editor built on the shared {@link SearchableSelect}, matching
 * the {@link PriorityPicker} / {@link AssigneePicker} pattern: the status badge
 * is the trigger and selecting an option updates the task. Read-only callers
 * pass `disabled` to render just the badge.
 */
export function StatusPicker({
  status,
  onChange,
  align = 'start',
  disabled = false,
}: {
  status: TaskStatus;
  onChange: (status: TaskStatus) => void;
  align?: 'start' | 'center' | 'end';
  disabled?: boolean;
}) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');

  if (disabled) {
    return <TaskStatusBadge status={status} />;
  }

  const options: SearchableSelectOption[] = TASK_STATUS_ORDER.map((s) => ({
    value: s,
    label: t(`status.${s}`),
  }));

  const trigger = (
    <button
      type="button"
      aria-label={t('fields.status')}
      className="focus-visible:ring-ring rounded-full focus-visible:ring-2 focus-visible:outline-none"
    >
      <TaskStatusBadge status={status} />
    </button>
  );

  return (
    <SearchableSelect
      value={status}
      onValueChange={(value) => {
        if (isTaskStatus(value)) onChange(value);
      }}
      options={options}
      align={align}
      trigger={trigger}
      aria-label={t('fields.status')}
      searchPlaceholder={t('fields.status')}
      emptyText={tCommon('search.noResults')}
      optionAction={(opt) =>
        isTaskStatus(opt.value) ? <TaskStatusBadge status={opt.value} /> : null
      }
    />
  );
}
