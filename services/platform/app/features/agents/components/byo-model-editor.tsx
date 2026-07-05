'use client';

import { Button } from '@tale/ui/button';
import { Row } from '@tale/ui/layout';
import { Plus } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { Input } from '@/app/components/ui/forms/input';
import {
  ReorderList,
  type ReorderItem,
} from '@/app/components/ui/forms/reorder-list';
import { useT } from '@/lib/i18n/client';

interface ByoModelItem extends ReorderItem {
  modelId: string;
}

interface ByoModelEditorProps {
  /** Ordered list of raw provider model ids (first = primary, rest = fallbacks). */
  models: string[];
  /** Called when the list changes (add, remove, reorder). */
  onChange: (models: string[]) => void;
}

/**
 * BYO model list editor. Unlike the platform {@link ModelSelector}, BYO models
 * are raw provider model ids typed verbatim by the operator (e.g.
 * `claude-opus-4-...`) — there is no catalog to pick from, so add is a
 * free-text field. The list stays an ordered set (first = primary), reuses the
 * shared reorder/remove affordances, and refuses to add a duplicate or an
 * empty id.
 */
export function ByoModelEditor({ models, onChange }: ByoModelEditorProps) {
  const { t } = useT('settings');
  const [draft, setDraft] = useState('');

  const items: ByoModelItem[] = useMemo(
    () => models.map((modelId) => ({ id: modelId, modelId })),
    [models],
  );

  const handleReorder = useCallback(
    (newItems: ByoModelItem[]) => onChange(newItems.map((i) => i.modelId)),
    [onChange],
  );

  const handleMoveUp = useCallback(
    (index: number) => {
      if (index === 0) return;
      const next = [...models];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      onChange(next);
    },
    [models, onChange],
  );

  const handleMoveDown = useCallback(
    (index: number) => {
      if (index >= models.length - 1) return;
      const next = [...models];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      onChange(next);
    },
    [models, onChange],
  );

  const handleRemove = useCallback(
    // BYO models are OPTIONAL (empty = use the credential's own default model),
    // so any entry — including the last — can be removed.
    (id: string) => onChange(models.filter((m) => m !== id)),
    [models, onChange],
  );

  const trimmed = draft.trim();
  const canAdd = trimmed.length > 0 && !models.includes(trimmed);

  const handleAdd = useCallback(() => {
    if (!canAdd) return;
    onChange([...models, trimmed]);
    setDraft('');
  }, [canAdd, models, trimmed, onChange]);

  return (
    <div className="space-y-2">
      <ReorderList
        items={items}
        onReorder={handleReorder}
        onMoveUp={handleMoveUp}
        onMoveDown={handleMoveDown}
        onRemove={handleRemove}
        minItems={0}
        moveUpLabel={t('agents.form.modelSelector.moveUp')}
        moveDownLabel={t('agents.form.modelSelector.moveDown')}
        dragHandleLabel={t('agents.form.modelSelector.dragHandle')}
        removeLabel={t('agents.form.removeModel')}
        renderItem={({ item }) => (
          <code className="min-w-0 flex-1 truncate text-sm">
            {item.modelId}
          </code>
        )}
      />
      <Row gap={2} align="start">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAdd();
            }
          }}
          placeholder={t('agents.form.byo.modelPlaceholder')}
          aria-label={t('agents.form.byo.modelLabel')}
          wrapperClassName="flex-1"
          autoComplete="off"
          spellCheck={false}
        />
        <Button
          type="button"
          variant="secondary"
          icon={Plus}
          disabled={!canAdd}
          onClick={handleAdd}
        >
          {t('agents.form.addModel')}
        </Button>
      </Row>
    </div>
  );
}

/** Alias — also used for env-managed external agents (raw model ids, no catalog). */
export const RuntimeModelEditor = ByoModelEditor;
