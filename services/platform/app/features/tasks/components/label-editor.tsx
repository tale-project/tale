'use client';

import { Button } from '@tale/ui/button';
import { Row } from '@tale/ui/layout';
import { Popover } from '@tale/ui/popover';
import { Check, Plus, Search, X } from 'lucide-react';
import { useMemo, useState, type KeyboardEvent } from 'react';

import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { AppError } from '@/lib/shared/errors/app-error';
import { cn } from '@/lib/utils/cn';

import {
  useCreateTaskLabel,
  useEnsureDefaultTaskLabels,
} from '../hooks/mutations';
import { useTaskLabels } from '../hooks/queries';
import { LABEL_DOT_CLASS, labelColor } from '../lib/labels';
import { TaskLabelBadge } from './task-label-badge';

const MAX_LABELS = 50;
const MAX_LABEL_LENGTH = 50;

type LabelOption = { name: string };

/**
 * Attach/detach project catalog labels on a task. Type a name that isn't in
 * the catalog to create it here (and attach it). Rename/delete stay in
 * {@link LabelManageDialog}. Colour is automatic from the name.
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
  const [creating, setCreating] = useState(false);
  const { labels: catalog } = useTaskLabels(projectId);
  const createLabel = useCreateTaskLabel();
  const ensureDefaults = useEnsureDefaultTaskLabels();

  const toggleLabel = (name: string) => {
    if (labels.includes(name)) {
      onChange(labels.filter((l) => l !== name));
    } else if (labels.length < MAX_LABELS) {
      onChange([...labels, name]);
    }
  };

  // The catalog keeps a label's spelling and is unique without regard to
  // case: matching folds case, the name sent keeps what was typed.
  const query = search.trim().slice(0, MAX_LABEL_LENGTH);
  const folded = query.toLowerCase();

  const options = useMemo<LabelOption[]>(() => {
    const rows = catalog.map((l) => ({ name: l.name }));
    if (!folded) return rows;
    return rows.filter((l) => l.name.toLowerCase().includes(folded));
  }, [catalog, folded]);

  const exactExists = catalog.some((l) => l.name.toLowerCase() === folded);
  const canCreate =
    query.length > 0 && !exactExists && labels.length < MAX_LABELS && !disabled;
  const itemCount = options.length + (canCreate ? 1 : 0);
  const createIndex = canCreate ? options.length : -1;

  const onCreateError = (error: unknown) => {
    if (error instanceof AppError) {
      const code = error.data?.code;
      if (typeof code === 'string') {
        toast({
          title: t(`labels.errors.${code}`, {
            defaultValue: t('labels.errors.createFailed'),
          }),
          variant: 'destructive',
        });
        return;
      }
    }
    toast({
      title: t('labels.errors.createFailed'),
      variant: 'destructive',
    });
  };

  const onCreate = async () => {
    if (!canCreate || creating) return;
    setCreating(true);
    try {
      await createLabel.mutateAsync({ projectId, name: query });
      if (!labels.includes(query) && labels.length < MAX_LABELS) {
        onChange([...labels, query]);
      }
      setSearch('');
      setHighlighted(0);
    } catch (error) {
      onCreateError(error);
    } finally {
      setCreating(false);
    }
  };

  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (itemCount === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((h) => (h + 1) % itemCount);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => (h - 1 + itemCount) % itemCount);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (canCreate && highlighted === createIndex) {
        void onCreate();
        return;
      }
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
              className="text-foreground hover:bg-muted h-6 gap-1 px-1.5 text-xs"
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
              maxLength={MAX_LABEL_LENGTH}
              placeholder={t('labels.add')}
              aria-label={t('labels.add')}
              disabled={creating}
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
                    'flex w-full cursor-default items-center gap-2 rounded-md p-2 text-left text-sm',
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
            {canCreate && (
              // oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- keyboard handled by the search input above
              <div
                role="option"
                aria-selected={false}
                data-highlighted={highlighted === createIndex || undefined}
                onClick={() => void onCreate()}
                onMouseEnter={() => setHighlighted(createIndex)}
                className={cn(
                  'flex w-full cursor-default items-center gap-2 rounded-md p-2 text-left text-sm',
                  highlighted === createIndex && 'bg-accent',
                  creating && 'pointer-events-none opacity-60',
                )}
              >
                <Plus
                  className="text-muted-foreground size-3.5 shrink-0"
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate">
                  {t('labels.createNamed', { name: query })}
                </span>
              </div>
            )}
            {itemCount === 0 && (
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
