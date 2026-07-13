'use client';

/**
 * The Board block's card — a generic, field-mapped kanban card matching the
 * tasks board's visual language (same `@tale/ui` Card anatomy, drag placeholder
 * and floating-overlay treatments). One card per row:
 *
 * - `card` maps row fields onto the anatomy (title, subtitle, meta row, badge);
 * - `subjectType` swaps the badge for the ambient `SubjectRunStatusChip`
 *   (id from the row, same as Collection's status-cell accessory);
 * - `actions` render in an overflow menu (house `DropdownMenu`); availability
 *   is data (`when` over the row), dispatch runs through the same
 *   bind-dispatch-effect path as `BoundButton` via `CardActionRunner` — a
 *   runner mounts per activation so the binding hook is instantiated once per
 *   (action × click), rules-of-hooks safe;
 * - `moveTo` (the keyboard path to the `move` binding) adds a "Move to"
 *   submenu listing every OTHER lane — activating one dispatches the same
 *   end-of-lane move a drop would, so the board stays operable without a
 *   pointer (WCAG 2.1.1);
 * - activation (click or Enter/Space on the card itself) fires `onActivate`.
 *   Like the tasks card, the explicit key handler wins over dnd-kit's keyboard
 *   activator, so keyboard users get card activation; pointer drag is
 *   unaffected.
 */
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { Row } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { MoreHorizontal } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { useT } from '@/lib/i18n/client';
import { evaluateWhen } from '@/lib/shared/platform/when_predicate';
import { cn } from '@/lib/utils/cn';
import { primitiveString } from '@/lib/utils/type-utils';

import { useBoundAction } from '../../hooks/use-bound-action';
import { useActionEffect } from '../../runtime/action-effects';
import { deriveDoneState, type BoundActionSpec } from './bound-button';
import { SubjectRunStatusChip } from './subject-run-status-chip';
import {
  hasTaskCommentFeedback,
  TaskCommentFeedbackDialog,
} from './task-comment-feedback-button';

/** Field map from a row to the card anatomy (`boardPropsSchema.card`). */
export interface BoardCardSpec {
  titleField: string;
  subtitleField?: string;
  metaFields?: string[];
  badgeField?: string;
}

/** The keyboard path to the board's `move` binding: every OTHER lane (already
 *  label-resolved by the Board) plus the move dispatcher — activating a target
 *  appends the card to that lane's end, exactly like a drop on the lane. */
export interface BoardMoveToSpec {
  targets: Array<{ value: string; label: string }>;
  onMove: (row: BoardRow, lane: string) => void;
}

type BoardRow = Record<string, unknown>;

/** Row field → display text; `undefined` for absent/empty/non-primitive values
 *  so the corresponding card slot collapses instead of rendering "undefined"
 *  (or "[object Object]"). */
function fieldText(
  row: BoardRow,
  field: string | undefined,
): string | undefined {
  if (field === undefined) return undefined;
  const value = row[field];
  if (value === '') return undefined;
  return primitiveString(value);
}

/** The same label rule as `BoundButton`: `labelKey` through the `automations`
 *  namespace with the literal (then the path) as fallback. */
function actionLabel(
  t: (key: string, params?: Record<string, string>) => string,
  action: BoundActionSpec,
): string {
  return action.labelKey
    ? t(action.labelKey, { defaultValue: action.label ?? action.path })
    : (action.label ?? action.path);
}

/**
 * Dispatches ONE card action, then unmounts (via `onSettled`). Mounted per
 * activation so `useBoundAction` binds the action's own path — the menu can't
 * call hooks per item. A `confirm` action shows the house ConfirmDialog first;
 * anything else runs on mount (consume-once ref guard for strict-mode double
 * effects).
 */
function CardActionRunner({
  action,
  row,
  onSettled,
}: {
  action: BoundActionSpec;
  row: BoardRow;
  onSettled: () => void;
}) {
  const { t } = useT('automations');
  const { dispatch } = useBoundAction(action.path, action.mode);
  const applyEffect = useActionEffect();
  const ranRef = useRef(false);
  const isFeedback = hasTaskCommentFeedback(action);
  const needsConfirm = Boolean(action.confirm) && !isFeedback;
  const [confirmOpen, setConfirmOpen] = useState(needsConfirm);
  const label = actionLabel(t, action);
  const confirmSpec = action.confirm;
  const confirmTitle =
    typeof confirmSpec === 'object' && confirmSpec.title
      ? confirmSpec.title
      : t('confirm', { defaultValue: 'Are you sure?' });
  const confirmDescription =
    typeof confirmSpec === 'object' && confirmSpec.description
      ? confirmSpec.description
      : label;

  const run = useCallback(async () => {
    try {
      const result = await dispatch(action.args, row);
      const alreadyExists =
        result !== null &&
        typeof result === 'object' &&
        'created' in result &&
        (result as { created?: unknown }).created === false;
      const effect =
        alreadyExists && action.onAlreadyExists
          ? action.onAlreadyExists
          : action.onSuccess;
      applyEffect(effect, result, row);
    } catch (err) {
      // The mutation/action layer (useConvexMutation) already toasts + logs the
      // failure; surface it here too rather than swallowing the rejection.
      console.error('[automation-board] card action failed', action.path, err);
    } finally {
      onSettled();
    }
  }, [action, applyEffect, dispatch, onSettled, row]);

  useEffect(() => {
    if (needsConfirm || isFeedback || ranRef.current) return;
    ranRef.current = true;
    void run();
  }, [isFeedback, needsConfirm, run]);

  if (isFeedback) {
    return (
      <TaskCommentFeedbackDialog
        action={action}
        item={row}
        open
        onOpenChange={(open) => {
          if (!open) onSettled();
        }}
      />
    );
  }

  if (!needsConfirm) return null;
  return (
    <ConfirmDialog
      open={confirmOpen}
      onOpenChange={(open) => {
        setConfirmOpen(open);
        if (!open) onSettled();
      }}
      title={confirmTitle}
      description={confirmDescription}
      variant={action.variant === 'destructive' ? 'destructive' : 'default'}
      onConfirm={() => {
        setConfirmOpen(false);
        void run();
      }}
    />
  );
}

/** The card's overflow menu — rendered when at least one action's `when`
 *  predicate holds for the row, or when the card can move to another lane.
 *  `doneWhen` disables an action entry (matching `BoundButton`'s done
 *  affordance) with its done label; `moveTo` adds the "Move to" submenu. */
function CardActionsMenu({
  actions,
  row,
  moveTo,
}: {
  actions: BoundActionSpec[];
  row: BoardRow;
  moveTo?: BoardMoveToSpec;
}) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const [pending, setPending] = useState<BoundActionSpec | null>(null);

  const groups: DropdownMenuGroup[] = [];
  if (actions.length > 0) {
    groups.push(
      actions.map((action) => {
        const { done } = deriveDoneState(action, row, false);
        const label = done
          ? action.doneLabelKey
            ? t(action.doneLabelKey, {
                defaultValue: action.doneLabel ?? actionLabel(t, action),
              })
            : (action.doneLabel ?? actionLabel(t, action))
          : actionLabel(t, action);
        return {
          type: 'item' as const,
          label,
          disabled: done,
          destructive: action.variant === 'destructive',
          onClick: () => setPending(action),
        };
      }),
    );
  }
  if (moveTo && moveTo.targets.length > 0) {
    groups.push([
      {
        type: 'sub',
        label: t('board.moveTo'),
        items: [
          moveTo.targets.map((target) => ({
            type: 'item' as const,
            label: target.label,
            onClick: () => moveTo.onMove(row, target.value),
          })),
        ],
      },
    ]);
  }

  return (
    <>
      <DropdownMenu
        align="end"
        trigger={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={tCommon('actions.openMenu')}
            className="-mr-1 shrink-0"
          >
            <MoreHorizontal aria-hidden className="size-4" />
          </Button>
        }
        items={groups}
      />
      {pending && (
        <CardActionRunner
          key={`${pending.path}:${pending.labelKey ?? pending.label ?? ''}`}
          action={pending}
          row={row}
          onSettled={() => setPending(null)}
        />
      )}
    </>
  );
}

export function BoardCard({
  row,
  rowId,
  card,
  subjectType,
  actions,
  moveTo,
  onActivate,
  dragging,
}: {
  row: BoardRow;
  /** The row's stable id — the dnd-kit sortable id and the subject id. */
  rowId: string;
  card: BoardCardSpec;
  /** When set, the badge slot becomes the subject's ambient run-status chip. */
  subjectType?: string;
  /** Per-card actions; entries whose `when` fails the row are hidden. */
  actions?: BoundActionSpec[];
  /** Keyboard path to the board's `move` binding ("Move to" submenu). */
  moveTo?: BoardMoveToSpec;
  onActivate?: (row: BoardRow) => void;
  /** True when rendered inside the DragOverlay (floating clone). */
  dragging?: boolean;
}) {
  const sortable = useSortable({ id: rowId, data: { type: 'card' } });
  const style = {
    transform: CSS.Translate.toString(sortable.transform),
    transition: sortable.transition,
  };

  const title = fieldText(row, card.titleField);
  const subtitle = fieldText(row, card.subtitleField);
  const meta = (card.metaFields ?? [])
    .map((field) => fieldText(row, field))
    .filter((text): text is string => text !== undefined);
  const badgeText = fieldText(row, card.badgeField);
  const badge = badgeText ? <Badge variant="outline">{badgeText}</Badge> : null;
  const statusSlot = subjectType ? (
    <SubjectRunStatusChip
      subjectType={subjectType}
      subjectId={rowId}
      fallback={badge}
    />
  ) : (
    badge
  );
  const applicable = (actions ?? []).filter(
    (action) => !action.when || evaluateWhen(action.when, row),
  );

  return (
    <Card
      asChild
      padding="sm"
      shadow="sm"
      interactive
      className={cn(
        'group text-left',
        onActivate && 'cursor-pointer hover:shadow-md',
        // While dragging, the in-place card becomes a faint placeholder marking
        // the slot the floating overlay will land in.
        sortable.isDragging && 'opacity-40',
        // The floating overlay clone lifts off the board: stronger shadow + ring.
        dragging && 'ring-border rotate-1 shadow-lg ring-1',
      )}
    >
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- draggable kanban card; dnd-kit's {...sortable.attributes} injects role/tabIndex at runtime and keyboard activation is handled via onKeyDown */}
      <div
        ref={sortable.setNodeRef}
        style={style}
        {...sortable.attributes}
        {...sortable.listeners}
        onClick={() => onActivate?.(row)}
        onKeyDown={(e) => {
          // Only the card itself — inner controls (the overflow menu) keep
          // their own keyboard semantics without also opening the card.
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onActivate?.(row);
          }
        }}
      >
        <Row gap={2} justify="between" align="start">
          <div className="min-w-0">
            <Text as="p" variant="label" className="line-clamp-2 leading-snug">
              {title ?? rowId}
            </Text>
            {subtitle && (
              <Text as="p" variant="caption" className="mt-0.5 line-clamp-1">
                {subtitle}
              </Text>
            )}
          </div>
          {(applicable.length > 0 || (moveTo?.targets.length ?? 0) > 0) && (
            <CardActionsMenu actions={applicable} row={row} moveTo={moveTo} />
          )}
        </Row>
        {(meta.length > 0 || statusSlot) && (
          <Row gap={2} justify="between" className="mt-3">
            <Row gap={2} wrap className="min-w-0">
              {meta.map((text, i) => (
                <Text
                  // The meta row is positional (a field map), so the index IS
                  // the identity.
                  // oxlint-disable-next-line react/no-array-index-key
                  key={i}
                  as="span"
                  variant="caption"
                  className="truncate"
                >
                  {text}
                </Text>
              ))}
            </Row>
            {statusSlot}
          </Row>
        )}
      </div>
    </Card>
  );
}
