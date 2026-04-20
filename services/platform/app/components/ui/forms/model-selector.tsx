'use client';

import { Plus } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { useT } from '@/lib/i18n/client';

import { ReorderList, type ReorderItem } from './reorder-list';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from './searchable-select';

interface ModelItem extends ReorderItem {
  modelId: string;
}

export interface ModelSelectorProps {
  /** Ordered list of model IDs (first = primary, rest = fallbacks) */
  models: string[];
  /** Called when models change (reorder, add, remove) */
  onChange: (models: string[]) => void;
  /** Available model options not yet selected */
  availableOptions: ReadonlyArray<SearchableSelectOption>;
  /** Resolve display name for a model ID */
  getDisplayName: (modelId: string) => string;
  /** Resolve the provider name that will serve this model (optional). */
  getProviderName?: (modelId: string) => string | undefined;
  /** Minimum number of models required (default 1) */
  minModels?: number;
  /** When true, hides drag/reorder controls */
  readonlyOrder?: boolean;
}

export function ModelSelector({
  models,
  onChange,
  availableOptions,
  getDisplayName,
  getProviderName,
  minModels = 1,
  readonlyOrder = false,
}: ModelSelectorProps) {
  const { t } = useT('settings');
  const [addOpen, setAddOpen] = useState(false);

  const items: ModelItem[] = useMemo(
    () => models.map((modelId) => ({ id: modelId, modelId })),
    [models],
  );

  const handleReorder = useCallback(
    (newItems: ModelItem[]) => {
      onChange(newItems.map((item) => item.modelId));
    },
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
    (id: string) => {
      if (models.length <= minModels) return;
      onChange(models.filter((m) => m !== id));
    },
    [models, minModels, onChange],
  );

  const handleAdd = useCallback(
    (modelId: string) => {
      onChange([...models, modelId]);
      setAddOpen(false);
    },
    [models, onChange],
  );

  return (
    <div className="space-y-2">
      <ReorderList
        items={items}
        onReorder={handleReorder}
        onMoveUp={handleMoveUp}
        onMoveDown={handleMoveDown}
        onRemove={handleRemove}
        readonlyOrder={readonlyOrder}
        moveUpLabel={t('agents.form.modelSelector.moveUp')}
        moveDownLabel={t('agents.form.modelSelector.moveDown')}
        dragHandleLabel={t('agents.form.modelSelector.dragHandle')}
        removeLabel={t('agents.form.removeModel')}
        renderItem={({ item }) => {
          const providerName = getProviderName?.(item.modelId);
          return (
            <div className="flex min-w-0 items-baseline gap-2">
              <code className="truncate text-sm">
                {getDisplayName(item.modelId)}
              </code>
              {providerName ? (
                <span className="text-muted-foreground flex-shrink-0 text-xs">
                  {providerName}
                </span>
              ) : null}
            </div>
          );
        }}
      />

      <SearchableSelect
        value={null}
        onValueChange={handleAdd}
        options={availableOptions}
        open={addOpen}
        onOpenChange={setAddOpen}
        searchPlaceholder={t('agents.form.searchModels')}
        emptyText={t('agents.form.noModelsFound')}
        aria-label={t('agents.form.addModel')}
        trigger={
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-sm transition-colors"
          >
            <Plus className="size-3.5" />
            <span>{t('agents.form.addModel')}</span>
          </button>
        }
      />
    </div>
  );
}
