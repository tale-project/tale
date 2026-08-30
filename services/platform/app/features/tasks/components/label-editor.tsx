'use client';

import { Button } from '@tale/ui/button';
import { Row } from '@tale/ui/layout';
import { Popover } from '@tale/ui/popover';
import { Check, Plus, Search, X } from 'lucide-react';
import { useMemo, useState, type KeyboardEvent } from 'react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useEnsureDefaultTaskLabels } from '../hooks/mutations';
import { useTaskLabels } from '../hooks/queries';
import { LABEL_DOT_CLASS, labelColor } from '../lib/labels';
import { TaskLabelBadge } from './task-label-badge';

const MAX_LABELS = 50;

type LabelOption = { name: string };

/**
 * Attach/detach project catalog labels on a task. Creating and editing
 * labels happens in {@link LabelManageDialog} — this picker only toggles
 * membership among labels that already exist on the project. Colour is
 * automatic from the name.
 *
 * Default labels are seeded when the picker first opens (user gesture).
 */
export function LabelEditor({
  labels,
  onChange,
  projectId,
  disabled,
}: {
  labels: string[];
  onChange: (labels: string[]) => void;
  projectId: string;
  disabled?: boolean;
}) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const [seeded, setSeeded] = useState(false);
  const { labels: catalog } = useTaskLabels(projectId);
  const ensureDefaults = useEnsureDefaultTaskLabels();

  const toggleLabel = (name: string) => {
    if (labels.includes(name)) {
      onChange(labels.filter((l) => l !== name));
    } else if (labels.length < MAX_LABELS) {
      onChange([...labels, name]);
    }
  };

  const options = useMemo<LabelOption[]>(() => {
    const query = search.trim().toLowerCase();
    const rows = catalog.map((l) => ({ name: l.name }));
    if (!query) return rows;
    return rows.filter((l) => l.name.includes(query));
  }, [catalog, search]);

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
      if (option) toggleLabel(option.name);
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (next && !disabled && !seeded) {
      setSeeded(true);
      void ensureDefaults.mutateAsync({ projectId }).catch(() => {
        setSeeded(false);
      });
    }
    setOpen(next);
    setSearch('');
    setHighlighted(0);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {labels.map((label) => (
        <TaskLabelBadge
          key={label}
          label={label}
          color={labelColor(label)}
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
          onOpenChange={handleOpenChange}
          modal
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
          <Row gap={2} className="border-border border-b p-2.5">
            <Search
              className="text-muted-foreground size-3.5 shrink-0"
              aria-hidden="true"
            />
            <input
              type="text"
              autoFocus
              value={search}
              placeholder={t('labels.add')}
              aria-label={t('labels.add')}
              onChange={(e) => {
                setSearch(e.target.value);
                setHighlighted(0);
              }}
              onKeyDown={onSearchKeyDown}
              className="placeholder:text-muted-foreground flex-1 bg-transparent text-base outline-none md:text-sm"
            />
          </Row>
          <div
            role="listbox"
            aria-multiselectable="true"
            className="max-h-64 overflow-y-auto p-1"
          >
            {options.map((option, index) => {
              const selected = labels.includes(option.name);
              return (
                // oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- keyboard handled by the search input above
                <div
                  key={option.name}
                  role="option"
                  aria-selected={selected}
                  data-highlighted={highlighted === index || undefined}
                  onClick={() => toggleLabel(option.name)}
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
                  <span className="min-w-0 flex-1 truncate capitalize">
                    {option.name}
                  </span>
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
                {catalog.length === 0
                  ? t('labels.emptyHint')
                  : tCommon('search.noResults')}
              </div>
            )}
          </div>
        </Popover>
      )}
    </div>
  );
}
