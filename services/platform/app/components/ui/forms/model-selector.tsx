'use client';

import { Button } from '@tale/ui/button';
import { SkeletonBox } from '@tale/ui/skeleton';
import { useSkeleton } from '@tale/ui/skeleton-context';
import { Plus } from 'lucide-react';
import { type ReactNode, useCallback, useMemo, useState } from 'react';

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
  /**
   * Optional per-model warning (e.g. ref missing from the org provider
   * catalog). When set, shown under the row in destructive text so an orphan
   * saved ref cannot look like a valid catalog pick.
   */
  getModelWarning?: (modelId: string) => string | undefined;
  /** Optional trailing affordance per selected model (e.g. an info popover). */
  renderItemAction?: (modelId: string) => ReactNode;
  /** Minimum number of models required (default 1) */
  minModels?: number;
  /** When true, hides drag/reorder controls */
  readonlyOrder?: boolean;
}

// Plain control — the real reorderable model list + add control. No skeleton
// logic of its own.
function ModelSelectorBase({
  models,
  onChange,
  availableOptions,
  getDisplayName,
  getProviderName,
  getModelWarning,
  renderItemAction,
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
        minItems={minModels}
        moveUpLabel={t('agents.form.modelSelector.moveUp')}
        moveDownLabel={t('agents.form.modelSelector.moveDown')}
        dragHandleLabel={t('agents.form.modelSelector.dragHandle')}
        removeLabel={t('agents.form.removeModel')}
        renderItem={({ item }) => {
          const providerName = getProviderName?.(item.modelId);
          const warning = getModelWarning?.(item.modelId);
          return (
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex min-w-0 items-baseline gap-2">
                <code className="truncate text-sm">
                  {getDisplayName(item.modelId)}
                </code>
                {providerName ? (
                  <span className="text-muted-foreground flex-shrink-0 text-xs">
                    {providerName}
                  </span>
                ) : null}
                {renderItemAction ? (
                  <span className="ml-auto shrink-0">
                    {renderItemAction(item.modelId)}
                  </span>
                ) : null}
              </div>
              {warning ? (
                <p
                  role="status"
                  className="text-destructive text-xs"
                  data-testid={`model-warning-${item.modelId}`}
                >
                  {warning}
                </p>
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
        contentClassName="w-[28rem] max-w-[calc(100vw-2rem)]"
        trigger={
          <Button type="button" variant="link" icon={Plus}>
            {t('agents.form.addModel')}
          </Button>
        }
      />
    </div>
  );
}

/**
 * Skeleton-aware ModelSelector. Inside a `<Skeletonize loading>` it masks the
 * plain control by rendering it inside a `<SkeletonBox>` — laid out invisibly
 * to set the exact size, pulse overlay on top — so the skeleton can never
 * drift.
 */
export function ModelSelector(props: ModelSelectorProps) {
  const loading = useSkeleton();
  if (loading) {
    return (
      <SkeletonBox>
        <ModelSelectorBase {...props} />
      </SkeletonBox>
    );
  }
  return <ModelSelectorBase {...props} />;
}
