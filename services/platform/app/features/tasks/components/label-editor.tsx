'use client';

import { Button } from '@tale/ui/button';
import { Popover } from '@tale/ui/popover';
import { Check, Plus, Search, X } from 'lucide-react';
import { useMemo, useState, type KeyboardEvent } from 'react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { LABEL_DOT_CLASS, labelColor, PREDEFINED_LABELS } from '../lib/labels';
import { TaskLabelBadge } from './task-label-badge';

// Mirror the backend caps (convex/tasks/mutations.ts) so the UI rejects before
// a round-trip; the server still normalizes (lowercase/dedupe) authoritatively.
const MAX_LABELS = 50;
const MAX_LABEL_LENGTH = 50;

/** A row in the picker: an existing/predefined label, or the create row. */
type LabelOption =
  | { kind: 'label'; name: string }
  | { kind: 'create'; name: string };

/**
 * Task labels as coloured chips plus a multi-select picker that mirrors the
 * status picker (searchable popover, check marks) but keeps the popover open
 * so several labels can be toggled in one visit. Predefined labels
 * (Bug / Feature / Improvement) are always offered; typing something new
 * surfaces a create row. Works in both the create modal (local draft state)
 * and edit mode (live `updateTask`): it just renders `labels` and calls
 * `onChange` with the next array.
 */
export function LabelEditor({
  labels,
  onChange,
  disabled,
}: {
  labels: string[];
  onChange: (labels: string[]) => void;
  disabled?: boolean;
}) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlighted, setHighlighted] = useState(0);

  const toggleLabel = (name: string) => {
    if (labels.includes(name)) {
      onChange(labels.filter((l) => l !== name));
    } else if (labels.length < MAX_LABELS) {
      onChange([...labels, name]);
    }
  };

  // Predefined first, then this task's custom labels alphabetically — the
  // picker always shows everything selectable, filtered by the search text.
  const options = useMemo<LabelOption[]>(() => {
    const predefined = PREDEFINED_LABELS.map((p) => p.name);
    const custom = labels
      .filter((l) => !predefined.includes(l))
      .sort((a, b) => a.localeCompare(b));
    const all = [...predefined, ...custom];
    const query = search.trim().toLowerCase();
    const filtered = query ? all.filter((l) => l.includes(query)) : all;
    const rows: LabelOption[] = filtered.map((name) => ({
      kind: 'label',
      name,
    }));
    const candidate = query.slice(0, MAX_LABEL_LENGTH);
    if (candidate && !all.includes(candidate) && labels.length < MAX_LABELS) {
      rows.push({ kind: 'create', name: candidate });
    }
    return rows;
  }, [labels, search]);

  const selectOption = (option: LabelOption) => {
    toggleLabel(option.name);
    if (option.kind === 'create') setSearch('');
  };

  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (options.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((h) => (h + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => (h - 1 + options.length) % options.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const option = options[Math.min(highlighted, options.length - 1)];
      if (option) selectOption(option);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {labels.map((label) => (
        <TaskLabelBadge
          key={label}
          label={label}
          className={cn(!disabled && 'pr-1')}
        >
          {!disabled && (
            <button
              type="button"
              aria-label={`${tCommon('actions.delete')} ${label}`}
              onClick={() => toggleLabel(label)}
              className="text-muted-foreground hover:text-foreground hover:bg-muted rounded-sm"
            >
              <X className="size-3" />
            </button>
          )}
        </TaskLabelBadge>
      ))}
      {!disabled && (
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            setSearch('');
            setHighlighted(0);
          }}
          contentClassName="w-60 p-0"
          trigger={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t('labels.add')}
              className="text-muted-foreground hover:text-foreground h-6 gap-1 px-1.5 text-xs"
            >
              <Plus className="size-3.5" />
              {labels.length === 0 ? t('fields.labels') : null}
            </Button>
          }
        >
          <div className="border-border flex items-center gap-2 border-b p-2.5">
            <Search
              className="text-muted-foreground size-3.5 shrink-0"
              aria-hidden="true"
            />
            <input
              type="text"
              autoFocus
              value={search}
              maxLength={MAX_LABEL_LENGTH}
              placeholder={t('labels.add')}
              aria-label={t('labels.add')}
              onChange={(e) => {
                setSearch(e.target.value);
                setHighlighted(0);
              }}
              onKeyDown={onSearchKeyDown}
              className="placeholder:text-muted-foreground flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          <div
            role="listbox"
            aria-multiselectable="true"
            className="max-h-64 overflow-y-auto p-1"
          >
            {options.map((option, index) => {
              const selected =
                option.kind === 'label' && labels.includes(option.name);
              return (
                // oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- keyboard handled by the search input above
                <div
                  key={`${option.kind}:${option.name}`}
                  role="option"
                  aria-selected={selected}
                  data-highlighted={highlighted === index || undefined}
                  onClick={() => selectOption(option)}
                  onMouseEnter={() => setHighlighted(index)}
                  className={cn(
                    'flex w-full cursor-default items-center gap-2 rounded-md p-2 text-left text-sm transition-colors',
                    highlighted === index && 'bg-accent',
                  )}
                >
                  <span
                    className={cn(
                      'size-2 shrink-0 rounded-full',
                      LABEL_DOT_CLASS[labelColor(option.name)],
                    )}
                    aria-hidden="true"
                  />
                  {option.kind === 'create' ? (
                    <span className="min-w-0 flex-1 truncate">
                      {t('labels.create', { label: option.name })}
                    </span>
                  ) : (
                    <span className="min-w-0 flex-1 truncate capitalize">
                      {option.name}
                    </span>
                  )}
                  {selected && (
                    <Check
                      className="text-primary size-4 shrink-0"
                      aria-hidden="true"
                    />
                  )}
                </div>
              );
            })}
            {options.length === 0 && (
              <div className="text-muted-foreground px-3 py-4 text-center text-sm">
                {tCommon('search.noResults')}
              </div>
            )}
          </div>
        </Popover>
      )}
    </div>
  );
}
