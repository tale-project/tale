'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Popover } from '@tale/ui/popover';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';

import { Input } from '@/app/components/ui/forms/input';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

// Mirror the backend caps (convex/tasks/mutations.ts) so the UI rejects before
// a round-trip; the server still normalizes (lowercase/dedupe) authoritatively.
const MAX_LABELS = 50;
const MAX_LABEL_LENGTH = 50;

/**
 * Freeform task labels as removable chips plus an "add" popover. Works in both
 * the create modal (local draft state) and edit mode (live `updateTask`): it
 * just renders `labels` and calls `onChange` with the next array. Labels are
 * lowercased + deduped here for instant feedback (the server does so too).
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
  const [draft, setDraft] = useState('');

  const addLabel = () => {
    const next = draft.trim().toLowerCase().slice(0, MAX_LABEL_LENGTH);
    if (!next || labels.includes(next) || labels.length >= MAX_LABELS) {
      setDraft('');
      return;
    }
    onChange([...labels, next]);
    setDraft('');
  };

  const removeLabel = (label: string) =>
    onChange(labels.filter((l) => l !== label));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {labels.map((label) => (
        <Badge key={label} variant="outline" className="gap-1 pr-1">
          {label}
          {!disabled && (
            <button
              type="button"
              aria-label={`${tCommon('actions.delete')} ${label}`}
              onClick={() => removeLabel(label)}
              className="text-muted-foreground hover:text-foreground hover:bg-background/60 rounded-sm"
            >
              <X className="size-3" />
            </button>
          )}
        </Badge>
      ))}
      {!disabled && labels.length < MAX_LABELS && (
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) setDraft('');
          }}
          contentClassName="w-56 p-2"
          trigger={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                'text-muted-foreground hover:text-foreground h-6 gap-1 px-1.5 text-xs',
              )}
            >
              <Plus className="size-3.5" />
              {labels.length === 0 ? t('fields.labels') : null}
            </Button>
          }
        >
          <div className="flex flex-col gap-2">
            <Input
              id="task-label-input"
              autoFocus
              value={draft}
              aria-label={t('fields.labels')}
              maxLength={MAX_LABEL_LENGTH}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addLabel();
                }
              }}
            />
            <Button
              size="sm"
              onClick={addLabel}
              disabled={draft.trim().length === 0}
            >
              {t('actions.add')}
            </Button>
          </div>
        </Popover>
      )}
    </div>
  );
}
