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

export interface SlugOption extends SearchableSelectOption {
  /** Optional secondary line shown below the label (e.g. provider name). */
  description?: string;
}

interface ProjectSlugListEditorProps {
  /** Slugs currently selected, in defined order. */
  value: string[];
  /** Called with the next slug list (already deduplicated). */
  onChange: (next: string[]) => void;
  /** Full catalog of selectable items. */
  options: ReadonlyArray<SlugOption>;
  /** Label for the "Add" button. */
  addLabel: string;
  /**
   * When `restricted`, an empty list is a lockout — render a destructive
   * banner. When `recommended`, an empty list is fine (nothing is pinned).
   */
  mode: 'recommended' | 'restricted';
  /** Disable adds/removes (e.g. while a mutation is in flight). */
  disabled?: boolean;
}

interface SlugRow extends ReorderItem {
  label: string;
  description?: string;
  fallback: boolean;
}

/**
 * Ordered list editor for project slug lists, modelled on the
 * `ReorderList` component used in agents settings. Selected items are
 * rendered as draggable rows with up/down arrows + remove buttons; the
 * "Add" button opens a searchable picker that appends to the end.
 *
 * Used by [project-agents-tab.tsx] to drive `recommendedAgentSlugs`,
 * `allowedAgentSlugs`, `recommendedModels`, and `allowedModels`. The
 * caller controls the option label shape (agents pass agent slugs;
 * models pass `<provider>:<id>` refs).
 */
export function ProjectSlugListEditor({
  value,
  onChange,
  options,
  addLabel,
  mode,
  disabled,
}: ProjectSlugListEditorProps) {
  const { t } = useT('projects');
  const { t: tCommon } = useT('common');
  const [pickerOpen, setPickerOpen] = useState(false);

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

  const selectedSet = useMemo(() => new Set(localValue), [localValue]);

  const remainingOptions = useMemo(
    () => options.filter((opt) => !selectedSet.has(opt.value)),
    [options, selectedSet],
  );

  const optionByValue = useMemo(() => {
    const map = new Map<string, SlugOption>();
    for (const opt of options) map.set(opt.value, opt);
    return map;
  }, [options]);

  // Framer Motion's `Reorder.Group` / `Reorder.Item` tracks items by
  // reference identity. If we recreated every SlugRow object on each
  // render, adding a new item would make every existing row look "new"
  // to Framer Motion — triggering a full set of layout animations and
  // visually skewing the list (and any sibling Reorder.Group sharing the
  // page). Cache rows in a ref-backed map keyed by slug so existing rows
  // keep their object reference unless their visible content actually
  // changed.
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
    // GC dropped slugs so the cache doesn't grow unbounded. Build a
    // disposable array of keys-to-delete instead of spreading the
    // iterator (oxlint flags spread-over-iterables on the hot path).
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

  const handleAdd = useCallback(
    (slug: string) => {
      if (selectedSet.has(slug)) return;
      commit([...localValue, slug]);
      setPickerOpen(false);
    },
    [selectedSet, localValue, commit],
  );

  const isLockedOut = mode === 'restricted' && localValue.length === 0;

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
            // Label-only inside the row. Long descriptions (e.g. agent
            // bios) used to be inlined with `shrink-0` and overflowed —
            // they're still discoverable in the searchable picker when
            // adding, and we surface them as a `title` tooltip here for
            // power users who want to recall the context on hover.
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

      {!disabled && remainingOptions.length > 0 ? (
        pickerOpen ? (
          <SearchableSelect
            value={null}
            onValueChange={handleAdd}
            options={remainingOptions}
            placeholder={addLabel}
            open
            onOpenChange={setPickerOpen}
          />
        ) : (
          <div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPickerOpen(true)}
            >
              <Plus className="size-4" aria-hidden="true" />
              {addLabel}
            </Button>
          </div>
        )
      ) : null}
    </Stack>
  );
}
