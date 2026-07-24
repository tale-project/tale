'use client';

import { Button } from '@tale/ui/button';
import { Grid, Row, Stack } from '@tale/ui/layout';
import { Popover } from '@tale/ui/popover';
import { ArrowLeft, Check, Plus, Search, X } from 'lucide-react';
import { useMemo, useState, type KeyboardEvent } from 'react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import {
  TASK_LABEL_COLORS,
  type TaskLabelColor,
} from '@/lib/shared/task-label-colors';
import { cn } from '@/lib/utils/cn';

import { useSetLabelColor } from '../hooks/mutations';
import { LABEL_DOT_CLASS, labelColor, PREDEFINED_LABELS } from '../lib/labels';
import { TaskLabelBadge, useTaskLabelColors } from './task-label-badge';

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
 * surfaces a create row; clicking a row's colour dot opens an in-popover
 * swatch view that saves a project-wide colour override. Works in both the
 * create modal (local draft state) and edit mode (live `updateTask`): it just
 * renders `labels` and calls `onChange` with the next array.
 */
export function LabelEditor({
  labels,
  onChange,
  projectId,
  disabled,
}: {
  labels: string[];
  onChange: (labels: string[]) => void;
  /** Resolves + persists the project's label colour overrides. */
  projectId: Id<'projects'>;
  disabled?: boolean;
}) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  // When set, the popover shows the colour-swatch view for this label
  // instead of the label list.
  const [colorEditing, setColorEditing] = useState<string | null>(null);
  const colors = useTaskLabelColors(projectId);
  const setLabelColor = useSetLabelColor();

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
          projectId={projectId}
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
            setColorEditing(null);
          }}
          // Opens inside the (modal) task dialog: without a modal popover the
          // dialog's scroll lock eats wheel events over the label list.
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
          {colorEditing ? (
            <ColorSwatchView
              label={colorEditing}
              current={labelColor(colorEditing, colors)}
              onBack={() => setColorEditing(null)}
              onPick={(color) => {
                setLabelColor.mutate({
                  projectId,
                  label: colorEditing,
                  color,
                });
                setColorEditing(null);
              }}
            />
          ) : (
            <>
              <Row gap={2} className="border-border border-b p-2.5">
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
                  className="placeholder:text-muted-foreground flex-1 bg-transparent text-base outline-none md:text-sm"
                />
              </Row>
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
                      {option.kind === 'create' ? (
                        <span
                          className={cn(
                            'size-2 shrink-0 rounded-full',
                            LABEL_DOT_CLASS[labelColor(option.name, colors)],
                          )}
                          aria-hidden="true"
                        />
                      ) : (
                        <Tooltip content={t('labels.changeColor')}>
                          <button
                            type="button"
                            aria-label={`${t('labels.changeColor')}: ${option.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setColorEditing(option.name);
                            }}
                            className="hover:ring-ring -m-1 flex size-5 shrink-0 items-center justify-center rounded-full hover:ring-1"
                          >
                            <span
                              className={cn(
                                'size-2 rounded-full',
                                LABEL_DOT_CLASS[
                                  labelColor(option.name, colors)
                                ],
                              )}
                              aria-hidden="true"
                            />
                          </button>
                        </Tooltip>
                      )}
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
            </>
          )}
        </Popover>
      )}
    </div>
  );
}

/** In-popover swatch grid that saves a project-wide colour for one label. */
function ColorSwatchView({
  label,
  current,
  onBack,
  onPick,
}: {
  label: string;
  current: TaskLabelColor;
  onBack: () => void;
  onPick: (color: TaskLabelColor) => void;
}) {
  const { t } = useT('tasks');
  return (
    <Stack gap={1} className="p-1">
      <div className="flex items-center gap-1.5 p-1">
        <button
          type="button"
          aria-label={t('labels.back')}
          onClick={onBack}
          className="text-muted-foreground hover:text-foreground hover:bg-muted rounded p-1"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
        </button>
        <span className="min-w-0 flex-1 truncate text-sm font-medium capitalize">
          {label}
        </span>
      </div>
      <Grid cols={5} gap={1} className="p-1">
        {TASK_LABEL_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={color}
            aria-pressed={color === current}
            onClick={() => onPick(color)}
            className={cn(
              'hover:bg-muted flex size-8 items-center justify-center rounded-md',
              color === current && 'ring-ring ring-1',
            )}
          >
            <span
              className={cn('size-3 rounded-full', LABEL_DOT_CLASS[color])}
              aria-hidden="true"
            />
          </button>
        ))}
      </Grid>
    </Stack>
  );
}
