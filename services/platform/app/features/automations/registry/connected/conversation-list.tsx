'use client';

/**
 * Connected `ConversationList` block — the master half of an inbox
 * master-detail split. Binds a cursor-paginated conversations query and
 * renders each row with the promoted list-item anatomy (sender, title,
 * preview snippet, timestamp, unread dot, status badge — all via the `item`
 * field map, so the block hardcodes no domain vocabulary).
 *
 * Selection is cross-block view state: clicking a row writes
 * `row[selection.idField]` into `$state.<selection.stateKey>` (a
 * ConversationThread/MessageComposer reads it back) and fires the optional
 * `onOpen` bound action (e.g. mark-as-read) with the row as `$selected`.
 * When `bulkActions` are configured the rows grow multi-select checkboxes;
 * the checked ids live in the view-state selection slice under the SAME
 * `selection.stateKey`, and each bulk action dispatches with
 * `ctx.selectionIds` so its authored `$selection.ids` args resolve.
 *
 * `filters` render as toggle chips merged into the bound query's args (the
 * Collection block's 'arg' semantics); `count` is an optional secondary query
 * rendered as a header badge; `emptyState` copy is authored as literals,
 * rendered verbatim.
 */
import type { Fields, PuckComponent } from '@measured/puck';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { EmptyState } from '@tale/ui/empty-state';
import { HStack, Row, VStack } from '@tale/ui/layout';
import { Inbox } from 'lucide-react';
import { useState } from 'react';

import { STATUS_VARIANT } from '@/app/components/ui/data-table/cell-kinds';
import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';
import { argsReferenceViewState } from '@/lib/shared/platform/function_bindings';
import type { BoundActionSpec } from '@/lib/shared/schemas/automation_views';
import { isRecord, primitiveString } from '@/lib/utils/type-utils';

import { useBoundAction } from '../../hooks/use-bound-action';
import { useBoundPaginatedQuery } from '../../hooks/use-bound-paginated-query';
import { useBoundQuery } from '../../hooks/use-bound-query';
import { useActionEffect } from '../../runtime/action-effects';
import { useOptionalViewState } from '../../runtime/view-state';
import { BindingStates, BlockFrame } from '../block-frame';
import { ConversationListItem } from './conversation-parts/list-item';
import { cleanPreviewText } from './conversation-parts/preview-text';

export interface ConversationListFilterSpec {
  field: string;
  values: string[];
  labelKey?: string;
  /** Literal display label per raw value; the raw value stays the
   *  dispatched arg — an unmapped value renders verbatim. */
  valueLabels?: Record<string, string>;
}

export interface ConversationListProps {
  id?: string;
  title?: string;
  query: { path: string; args?: unknown };
  /** Secondary count binding (e.g. per-status totals) — a header badge. */
  count?: { path: string; args?: unknown };
  perPage?: number;
  /** Field map from a conversation row to the list-item anatomy. */
  item: {
    titleField: string;
    senderField?: string;
    previewField?: string;
    timestampField?: string;
    unreadField?: string;
    badgeField?: string;
    /** Literal display label per raw `badgeField` value — an unmapped value
     *  renders verbatim; the variant keys off the raw value. */
    badgeLabels?: Record<string, string>;
  };
  filters?: ConversationListFilterSpec[];
  /** Master-detail selection: clicking an item writes `row[idField]` into
   *  view state under `stateKey` (read back via `$state.<key>`). */
  selection: { stateKey: string; idField: string };
  /** Fired when an item opens (e.g. mark-as-read) — a bound mutation. */
  onOpen?: BoundActionSpec;
  /** Multi-select bulk actions — args bind ids via `$selection.ids`. */
  bulkActions?: BoundActionSpec[];
  emptyState?: { titleKey?: string; descriptionKey?: string };
}

/** Interpret an `unreadField` value: a positive count or a `true` flag. */
export function isUnreadValue(value: unknown): boolean {
  if (typeof value === 'number') return value > 0;
  return value === true;
}

/** Read a count query's result: a bare number, or a record's `count` field. */
export function readCountValue(data: unknown): number | undefined {
  if (typeof data === 'number') return data;
  if (isRecord(data) && typeof data.count === 'number') return data.count;
  return undefined;
}

/** Filter toggle chips — each declared value merges into the query args. */
function FilterChips({
  filters,
  values,
  onChange,
}: {
  filters: ConversationListFilterSpec[];
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  return (
    <Row gap={2} wrap>
      {filters.map((filter) => (
        <Row
          key={filter.field}
          gap={1}
          wrap
          role="group"
          aria-label={filter.labelKey ?? filter.field}
        >
          {filter.values.map((value) => {
            const active = values[filter.field] === value;
            return (
              <Button
                key={value}
                size="sm"
                variant={active ? 'primary' : 'secondary'}
                aria-pressed={active}
                onClick={() => {
                  const next = { ...values };
                  if (active) delete next[filter.field];
                  else next[filter.field] = value;
                  onChange(next);
                }}
              >
                {filter.valueLabels?.[value] ?? value}
              </Button>
            );
          })}
        </Row>
      ))}
    </Row>
  );
}

/**
 * One bulk-action button: dispatches with the list's selection slice as
 * `ctx.selectionIds` (so `$selection.ids` args resolve), applies the action's
 * `onSuccess` effect, then clears the selection. Mirrors BoundButton's
 * label/confirm surface; BoundButton itself can't carry a dispatch context.
 */
function BulkActionButton({
  action,
  ids,
  onDone,
}: {
  action: BoundActionSpec;
  ids: string[];
  onDone: () => void;
}) {
  const { t } = useT('automations');
  const { dispatch, isPending } = useBoundAction(action.path, action.mode);
  const applyEffect = useActionEffect();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const label = action.labelKey
    ? t(action.labelKey, { defaultValue: action.label ?? action.path })
    : (action.label ?? action.path);

  const run = async () => {
    try {
      const result = await dispatch(action.args, undefined, {
        selectionIds: ids,
      });
      applyEffect(action.onSuccess, result);
      onDone();
    } catch (err) {
      // The mutation/action layer (useConvexMutation) already toasts + logs;
      // surface it here too rather than swallowing the rejection.
      console.error(
        '[automation-binding] bulk action failed',
        action.path,
        err,
      );
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant={action.variant ?? 'secondary'}
        disabled={isPending || ids.length === 0}
        onClick={() => {
          if (action.confirm) {
            setConfirmOpen(true);
            return;
          }
          void run();
        }}
      >
        {label}
      </Button>
      {action.confirm && (
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={t('confirm', { defaultValue: 'Are you sure?' })}
          description={label}
          variant={action.variant === 'destructive' ? 'destructive' : 'default'}
          onConfirm={() => {
            setConfirmOpen(false);
            void run();
          }}
        />
      )}
    </>
  );
}

export function ConversationList({
  title,
  query,
  count,
  perPage,
  item,
  filters,
  selection,
  onOpen,
  bulkActions,
  emptyState,
}: ConversationListProps) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const { formatDateSmart } = useFormatDate();
  const viewState = useOptionalViewState();
  const applyEffect = useActionEffect();

  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const baseArgs = isRecord(query.args) ? query.args : {};
  const mergedArgs =
    (filters?.length ?? 0) > 0 ? { ...baseArgs, ...filterValues } : query.args;

  const { results, status, loadMore, blocked, needsConfig } =
    useBoundPaginatedQuery(query.path, mergedArgs, { perPage });
  // Hooks run unconditionally: an absent `count` binds the empty (invalid)
  // path, which the hook resolves to `blocked` without calling anything.
  const countQuery = useBoundQuery(count?.path ?? '', count?.args);
  const countValue = count ? readCountValue(countQuery.data) : undefined;
  const { dispatch: dispatchOpen } = useBoundAction(
    onOpen?.path ?? '',
    onOpen?.mode ?? 'mutation',
  );

  const stateKey = selection.stateKey;
  const selectedId = viewState?.state[stateKey];
  const checkedIds = viewState?.selectionIds[stateKey] ?? [];
  const showCheckboxes = (bulkActions?.length ?? 0) > 0 && viewState !== null;

  const openRow = (row: Record<string, unknown>) => {
    const id = row[selection.idField];
    if (typeof id !== 'string') {
      console.warn(
        '[automations] ConversationList: row is missing a string id field',
        selection.idField,
      );
      return;
    }
    viewState?.setState(stateKey, id);
    if (onOpen) {
      void dispatchOpen(onOpen.args, row)
        .then((result) => applyEffect(onOpen.onSuccess, result, row))
        .catch((err: unknown) => {
          console.error('[automation-binding] onOpen failed', onOpen.path, err);
        });
    }
  };

  const setChecked = (id: string, checked: boolean) => {
    const next = checked
      ? [...checkedIds, id]
      : checkedIds.filter((existing) => existing !== id);
    viewState?.setSelectionIds(stateKey, next);
  };

  const awaiting = needsConfig && argsReferenceViewState(query.args);

  const headerActions = (
    <Row gap={2} wrap className="justify-end">
      {countValue !== undefined && countValue !== 0 && (
        <Badge variant="slate">{countValue}</Badge>
      )}
      {(filters?.length ?? 0) > 0 && !blocked && !needsConfig && (
        <FilterChips
          filters={filters ?? []}
          values={filterValues}
          onChange={setFilterValues}
        />
      )}
    </Row>
  );

  const stringOf = primitiveString;
  const timestampOf = (value: unknown): string | undefined => {
    if (typeof value === 'number') return formatDateSmart(new Date(value));
    if (typeof value === 'string' && value !== '') {
      return formatDateSmart(value);
    }
    return undefined;
  };

  return (
    <BlockFrame title={title} icon={Inbox} actions={headerActions}>
      <BindingStates
        blocked={blocked}
        path={query.path}
        needsConfig={needsConfig && !awaiting}
        awaitingState={awaiting}
        loading={status === 'LoadingFirstPage'}
      >
        {results.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={emptyState?.titleKey ?? t('binding.empty')}
            description={emptyState?.descriptionKey}
          />
        ) : (
          <VStack gap={3}>
            {showCheckboxes && checkedIds.length > 0 && (
              <Row
                gap={2}
                wrap
                className="items-center"
                role="toolbar"
                aria-label={tCommon('labels.nSelected', {
                  count: checkedIds.length,
                })}
              >
                <Badge variant="blue">
                  {tCommon('labels.nSelected', { count: checkedIds.length })}
                </Badge>
                {(bulkActions ?? []).map((action, index) => (
                  <BulkActionButton
                    key={`${action.path}-${index}`}
                    action={action}
                    ids={checkedIds}
                    onDone={() => viewState?.setSelectionIds(stateKey, [])}
                  />
                ))}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => viewState?.setSelectionIds(stateKey, [])}
                >
                  {tCommon('actions.clearAll')}
                </Button>
              </Row>
            )}
            <ul className="divide-border -mx-5 divide-y border-y">
              {results.map((row, index) => {
                const id = stringOf(row[selection.idField]) ?? String(index);
                const badgeValue = item.badgeField
                  ? stringOf(row[item.badgeField])
                  : undefined;
                const preview = item.previewField
                  ? stringOf(row[item.previewField])
                  : undefined;
                return (
                  <li key={id}>
                    <ConversationListItem
                      title={stringOf(row[item.titleField])}
                      sender={
                        item.senderField
                          ? stringOf(row[item.senderField])
                          : undefined
                      }
                      preview={
                        preview === undefined
                          ? undefined
                          : cleanPreviewText(preview)
                      }
                      timestampLabel={
                        item.timestampField
                          ? timestampOf(row[item.timestampField])
                          : undefined
                      }
                      unread={
                        item.unreadField
                          ? isUnreadValue(row[item.unreadField])
                          : false
                      }
                      badge={
                        badgeValue !== undefined && (
                          <Badge
                            variant={STATUS_VARIANT[badgeValue] ?? 'slate'}
                          >
                            {item.badgeLabels?.[badgeValue] ?? badgeValue}
                          </Badge>
                        )
                      }
                      selected={selectedId === id}
                      showCheckbox={showCheckboxes}
                      checked={checkedIds.includes(id)}
                      onOpen={() => openRow(row)}
                      onCheckedChange={(checked) => setChecked(id, checked)}
                      checkboxLabel={tCommon('aria.selectRow')}
                      unreadLabel={tCommon('aria.unread')}
                    />
                  </li>
                );
              })}
            </ul>
            {(status === 'CanLoadMore' || status === 'LoadingMore') && (
              <HStack gap={3} className="items-center justify-center">
                <Button
                  variant="ghost"
                  disabled={status === 'LoadingMore'}
                  onClick={() => loadMore(perPage ?? 30)}
                >
                  {status === 'LoadingMore'
                    ? t('list.loadingMore')
                    : t('list.loadMore')}
                </Button>
              </HStack>
            )}
          </VStack>
        )}
      </BindingStates>
    </BlockFrame>
  );
}

type ConversationListBlockProps = Partial<ConversationListProps>;

/**
 * The registry entry for `registerConnectedBlock('ConversationList', …)` —
 * wired into `registry/tale-config.tsx` by the registration site (kept out of
 * this file so the block stays import-cycle-free).
 */
export const conversationListBlock: {
  fields: Fields;
  render: PuckComponent<ConversationListBlockProps>;
} = {
  fields: { title: { type: 'text' } },
  render: ({
    title,
    query,
    count,
    perPage,
    item,
    filters,
    selection,
    onOpen,
    bulkActions,
    emptyState,
  }) =>
    query && item && selection ? (
      <ConversationList
        title={title}
        query={query}
        count={count}
        perPage={perPage}
        item={item}
        filters={filters}
        selection={selection}
        onOpen={onOpen}
        bulkActions={bulkActions}
        emptyState={emptyState}
      />
    ) : (
      <></>
    ),
};
