'use client';

import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  ReorderList,
  type ReorderItem,
} from '@/app/components/ui/forms/reorder-list';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/app/components/ui/forms/searchable-select';
import { useT } from '@/lib/i18n/client';

/**
 * Drop section headers whose section has no options left (all selected).
 * The new agent options are a flat list, so this is a no-op there; it keeps
 * the picker correct if a caller ever passes sectioned options again.
 */
function pruneEmptySections(
  options: ReadonlyArray<SearchableSelectOption>,
): SearchableSelectOption[] {
  const out: SearchableSelectOption[] = [];
  let pendingHeader: SearchableSelectOption | null = null;

  for (const option of options) {
    if (option.isSectionHeader) {
      pendingHeader = option;
      continue;
    }
    if (pendingHeader) {
      out.push(pendingHeader);
      pendingHeader = null;
    }
    out.push(option);
  }

  return out;
}

export interface SlugOption extends SearchableSelectOption {
  /** Optional secondary line shown below the label (e.g. provider name). */
  description?: string;
}

interface ProjectSlugListAddProps {
  value: string[];
  onChange: (next: string[]) => void;
  options: ReadonlyArray<SlugOption>;
  addLabel: string;
  disabled?: boolean;
}

/**
 * Header-side "Add agent/model" control. Lives next to the section title so
 * empty lists don't leave a lone CTA under the mode radios.
 */
export function ProjectSlugListAdd({
  value,
  onChange,
  options,
  addLabel,
  disabled,
}: ProjectSlugListAddProps) {
  const { t: tCommon } = useT('common');
  const [pickerOpen, setPickerOpen] = useState(false);

  const selectedSet = useMemo(() => new Set(value), [value]);
  const remainingOptions = useMemo(
    () =>
      pruneEmptySections(options.filter((opt) => !selectedSet.has(opt.value))),
    [options, selectedSet],
  );

  const handleAdd = useCallback(
    (slug: string) => {
      if (selectedSet.has(slug)) return;
      onChange([...value, slug]);
      setPickerOpen(false);
    },
    [selectedSet, value, onChange],
  );

  if (disabled || remainingOptions.length === 0) return null;

  return (
    <SearchableSelect
      value={null}
      onValueChange={handleAdd}
      options={remainingOptions}
      open={pickerOpen}
      onOpenChange={setPickerOpen}
      align="end"
      contentClassName="w-[28rem] max-w-[calc(100vw-2rem)]"
      searchPlaceholder={tCommon('search.placeholder')}
      emptyText={tCommon('search.noResults')}
      aria-label={addLabel}
      trigger={
        <Button type="button" variant="secondary" size="sm" className="gap-2">
          <Plus className="size-4" aria-hidden="true" />
          {addLabel}
        </Button>
      }
    />
  );
}

interface ProjectSlugListEditorProps {
  /** Slugs currently selected, in defined order. */
  value: string[];
  /** Called with the next slug list (already deduplicated). */
  onChange: (next: string[]) => void;
  /** Full catalog of selectable items. */
  options: ReadonlyArray<SlugOption>;
  /**
   * When `restricted`, an empty list is a lockout — render a destructive
   * banner. When `recommended`, an empty list is fine (nothing is pinned).
   */
  mode: 'recommended' | 'restricted';
  /** Disable removes/reorders (e.g. while a mutation is in flight). */
  disabled?: boolean;
}

interface SlugRow extends ReorderItem {
  label: string;
  description?: string;
  fallback: boolean;
}

/**
 * Ordered list editor for project slug lists. Selected items are draggable
 * rows with up/down + remove. Adding is owned by {@link ProjectSlugListAdd}
 * in the section header (same pattern as Files → New folder).
 */
export function ProjectSlugListEditor({
  value,
  onChange,
  options,
  mode,
  disabled,
}: ProjectSlugListEditorProps) {
  const { t } = useT('projects');
  const { t: tCommon } = useT('common');

  // Optimistic local order. The parent's `value` lags behind by a Convex
  // roundtrip, so driving the list straight from it would make framer-motion
  // snap items back to the pre-drag order (Reorder.Item uses
  // `dragSnapToOrigin`), then re-animate to the new order once the server
  // echoed back — a visible "skew". Update locally on every interaction and
  // adopt the server value only when it differs from what we last committed
  // (i.e. an external change). Compare by joined string so reference churn
  // from Convex doesn't trigger spurious re-syncs.
  const [localValue, setLocalValue] = useState(value);
  const lastCommittedKeyRef = useRef(value.join(' '));
  const valueKey = value.join(' ');
  useEffect(() => {
    if (valueKey !== lastCommittedKeyRef.current) {
      setLocalValue(value);
      lastCommittedKeyRef.current = valueKey;
    }
  }, [valueKey, value]);

  const commit = useCallback(
    (next: string[]) => {
      setLocalValue(next);
      lastCommittedKeyRef.current = next.join(' ');
      onChange(next);
    },
    [onChange],
  );

  const optionByValue = useMemo(() => {
    const map = new Map<string, SlugOption>();
    for (const opt of options) map.set(opt.value, opt);
    return map;
  }, [options]);

  // Framer Motion's `Reorder.Group` / `Reorder.Item` tracks items by
  // reference identity. Cache rows in a ref-backed map keyed by slug so
  // existing rows keep their object reference unless content changed.
  const rowsByIdRef = useRef(new Map<string, SlugRow>());
  const rows = useMemo<SlugRow[]>(() => {
    const result: SlugRow[] = [];
    const liveIds = new Set<string>();
    for (const slug of localValue) {
      liveIds.add(slug);
      const opt = optionByValue.get(slug);
      const fresh: SlugRow = {
        id: slug,
        label: opt?.label ?? slug,
        description: opt?.description,
        fallback: !opt,
      };
      const prev = rowsByIdRef.current.get(slug);
      if (
        prev &&
        prev.label === fresh.label &&
        prev.description === fresh.description &&
        prev.fallback === fresh.fallback
      ) {
        result.push(prev);
      } else {
        rowsByIdRef.current.set(slug, fresh);
        result.push(fresh);
      }
    }
    const toDelete: string[] = [];
    for (const cachedId of rowsByIdRef.current.keys()) {
      if (!liveIds.has(cachedId)) toDelete.push(cachedId);
    }
    for (const id of toDelete) rowsByIdRef.current.delete(id);
    return result;
  }, [localValue, optionByValue]);

  const handleReorder = useCallback(
    (next: SlugRow[]) => {
      commit(next.map((row) => row.id));
    },
    [commit],
  );

  const handleMoveUp = useCallback(
    (index: number) => {
      if (index <= 0 || index >= localValue.length) return;
      const next = [...localValue];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      commit(next);
    },
    [localValue, commit],
  );

  const handleMoveDown = useCallback(
    (index: number) => {
      if (index < 0 || index >= localValue.length - 1) return;
      const next = [...localValue];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      commit(next);
    },
    [localValue, commit],
  );

  const handleRemove = useCallback(
    (slug: string) => {
      commit(localValue.filter((s) => s !== slug));
    },
    [localValue, commit],
  );

  const isLockedOut = mode === 'restricted' && localValue.length === 0;

  if (rows.length === 0 && !isLockedOut) return null;

  return (
    <Stack gap={3}>
      {rows.length > 0 ? (
        <ReorderList<SlugRow>
          items={rows}
          onReorder={handleReorder}
          onMoveUp={handleMoveUp}
          onMoveDown={handleMoveDown}
          onRemove={handleRemove}
          readonlyOrder={disabled}
          moveUpLabel={tCommon('moveUp')}
          moveDownLabel={tCommon('moveDown')}
          dragHandleLabel={tCommon('drag')}
          removeLabel={tCommon('remove')}
          renderItem={({ item }) => (
            <Row
              gap={2}
              align="baseline"
              className="min-w-0"
              title={item.description}
            >
              <Text as="span" variant="body" truncate className="min-w-0">
                {item.label}
              </Text>
              {item.fallback ? (
                <Text
                  as="span"
                  variant="caption"
                  className="text-muted-foreground shrink-0"
                >
                  ({t('editor.slugFallback')})
                </Text>
              ) : null}
            </Row>
          )}
        />
      ) : null}

      {isLockedOut ? (
        <div className="border-destructive/40 bg-destructive/5 rounded-md border p-3">
          <Text variant="caption" className="text-destructive">
            {t('editor.slugEditorEmptyLockout')}
          </Text>
        </div>
      ) : null}
    </Stack>
  );
}
