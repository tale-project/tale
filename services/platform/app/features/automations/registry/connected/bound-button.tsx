'use client';

/**
 * The reusable action unit for connected blocks: a button bound to ONE
 * allowlisted Convex function. Availability is data (`when` over the bound item);
 * dispatch resolves arg templates (`$orgId` / `$selected*`) against the item.
 * Rendered once per (row × action), so the binding hook is called once per
 * instance — rules-of-hooks safe.
 */
import { Button } from '@tale/ui/button';
import { useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { useT } from '@/lib/i18n/client';
import { evaluateWhen } from '@/lib/shared/platform/when_predicate';
import type { BoundActionSpec } from '@/lib/shared/schemas/automation_views';

import { useBoundAction } from '../../hooks/use-bound-action';
import {
  type ActionEffect,
  useActionEffect,
} from '../../runtime/action-effects';
import {
  hasTaskCommentFeedback,
  TaskCommentFeedbackButton,
} from './task-comment-feedback-button';

// The action-spec shape is a `z.infer` re-export of `boundActionSchema`
// (`lib/shared/schemas/automation_views.ts`) — one source of truth, no schema↔runtime
// drift. Re-exported here so the sibling blocks keep their import site.
export type { BoundActionSpec };

/**
 * A row action that only applies a client EFFECT (e.g. open the row's detail
 * overlay) — no Convex function call. Same availability gating (`when`) and
 * labeling as a bound action; discriminated from `BoundActionSpec` by the
 * absent `path`. Effect templates resolve against the row (`$selected.*`).
 */
export interface EffectActionSpec {
  label?: string;
  labelKey?: string;
  /** Availability predicate over the bound item (when_predicate grammar). */
  when?: string;
  variant?: 'primary' | 'secondary' | 'destructive' | 'ghost';
  effect: ActionEffect;
  path?: never;
}

/** What a connected table row renders per action: call a function, or apply an effect. */
export type RowActionSpec = BoundActionSpec | EffectActionSpec;

/** Discriminate an effect-only action (no function reference to bind). */
export function isEffectAction(
  action: RowActionSpec,
): action is EffectActionSpec {
  return action.path === undefined;
}

/**
 * Decide the per-row "done" state. Pure (testable): `done` is true when the row's
 * `doneWhen` predicate holds OR the action already ran this session (`justRan`).
 * `latchesOnRun` — whether a successful run should flip the button to done — is
 * true ONLY for actions that declare a done label, so ordinary actions
 * (Start / Mark done) never self-disable after a click.
 */
export function deriveDoneState(
  action: Pick<BoundActionSpec, 'doneWhen' | 'doneLabelKey' | 'doneLabel'>,
  item: Record<string, unknown> | undefined,
  justRan: boolean,
): { done: boolean; latchesOnRun: boolean } {
  const latchesOnRun = Boolean(action.doneLabelKey || action.doneLabel);
  const doneByRow =
    item && action.doneWhen ? evaluateWhen(action.doneWhen, item) : false;
  return { done: justRan || doneByRow, latchesOnRun };
}

/**
 * Session latch for consume-once actions. Collection rebuilds column cells when
 * the bound query refreshes after a create, which remounts `BoundButton` and
 * would wipe React `useState` — keep the latch in module memory keyed by
 * `path` + stable row id so "Created" survives that remount for the tab.
 */
const sessionDoneLatches = new Set<string>();

/** Stable row key for the session latch (`_id` / `id`); undefined → no latch. */
export function sessionLatchRowKey(
  item: Record<string, unknown> | undefined,
): string | undefined {
  if (!item) return undefined;
  const id = item._id ?? item.id;
  if (typeof id === 'string' && id.length > 0) return id;
  if (typeof id === 'number' && Number.isFinite(id)) return String(id);
  return undefined;
}

export function sessionLatchKey(
  path: string,
  item: Record<string, unknown> | undefined,
): string | undefined {
  const rowKey = sessionLatchRowKey(item);
  return rowKey === undefined ? undefined : `${path}::${rowKey}`;
}

/** Test helper — clear latches between cases. */
export function clearSessionDoneLatches(): void {
  sessionDoneLatches.clear();
}

/** Record a row+path as done for this tab session (before onSuccess side effects). */
export function markSessionDoneLatched(
  path: string,
  item: Record<string, unknown> | undefined,
): boolean {
  const key = sessionLatchKey(path, item);
  if (key === undefined) return false;
  sessionDoneLatches.add(key);
  return true;
}

/** Whether this row+path was latched done this session (survives remount). */
export function isSessionDoneLatched(
  path: string,
  item: Record<string, unknown> | undefined,
): boolean {
  const key = sessionLatchKey(path, item);
  return key !== undefined && sessionDoneLatches.has(key);
}

export function BoundButton({
  action,
  item,
  size = 'sm',
}: {
  action: BoundActionSpec;
  item?: Record<string, unknown>;
  size?: 'sm' | 'default';
}) {
  // Feedback-first actions (Request changes) own their own hooks — early
  // return before this component's hooks so rules-of-hooks stay clean.
  if (hasTaskCommentFeedback(action)) {
    return (
      <TaskCommentFeedbackButton action={action} item={item} size={size} />
    );
  }
  return <DispatchBoundButton action={action} item={item} size={size} />;
}

function DispatchBoundButton({
  action,
  item,
  size = 'sm',
}: {
  action: BoundActionSpec;
  item?: Record<string, unknown>;
  size?: 'sm' | 'default';
}) {
  const { t } = useT('automations');
  const { dispatch, isPending } = useBoundAction(action.path, action.mode);
  const applyEffect = useActionEffect();
  // Consume-once feedback: a successful run leaves the row "done" for the session,
  // even when the row carries no persistent signal (e.g. a GitHub issue → task).
  const sessionDone = isSessionDoneLatched(action.path, item);
  // Local bump so this instance re-renders when it sets the latch; sessionDone
  // is also read every render so a remount after latch (before local state) still
  // shows the done label.
  const [localDone, setLocalDone] = useState(false);
  const justRan = sessionDone || localDone;
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (item && action.when && !evaluateWhen(action.when, item)) return null;

  const { done, latchesOnRun } = deriveDoneState(action, item, justRan);

  const label = action.labelKey
    ? t(action.labelKey, { defaultValue: action.label ?? action.path })
    : (action.label ?? action.path);

  if (done) {
    const doneLabel = action.doneLabelKey
      ? t(action.doneLabelKey, { defaultValue: action.doneLabel ?? label })
      : (action.doneLabel ?? label);
    return (
      <Button size={size} variant="ghost" disabled>
        {doneLabel}
      </Button>
    );
  }

  const confirmSpec = action.confirm;
  const confirmTitle =
    typeof confirmSpec === 'object' && confirmSpec.title
      ? t(confirmSpec.title, { defaultValue: confirmSpec.title })
      : t('confirm', { defaultValue: 'Are you sure?' });
  const confirmDescription =
    typeof confirmSpec === 'object' && confirmSpec.description
      ? t(confirmSpec.description, { defaultValue: confirmSpec.description })
      : label;

  const run = async () => {
    try {
      const result = await dispatch(action.args, item);
      // Idempotent creates may return `created: false` — prefer onAlreadyExists
      // when declared so a re-click doesn't re-open the same detail.
      const alreadyExists =
        result !== null &&
        typeof result === 'object' &&
        'created' in result &&
        (result as { created?: unknown }).created === false;
      const effect =
        alreadyExists && action.onAlreadyExists
          ? action.onAlreadyExists
          : action.onSuccess;
      // Latch before onSuccess — toast/openDetail/setState can synchronously
      // re-render Collection and remount this button; session memory must be
      // set first so the new instance reads "Created".
      if (latchesOnRun && !alreadyExists) {
        markSessionDoneLatched(action.path, item);
        setLocalDone(true);
      }
      applyEffect(effect, result, item);
    } catch (err) {
      // The mutation/action layer (useConvexMutation) already toasts + logs the
      // failure; surface it here too rather than swallowing the rejection.
      console.error('[automation-binding] action failed', action.path, err);
    }
  };

  return (
    <>
      <Button
        size={size}
        variant={action.variant ?? 'secondary'}
        disabled={isPending}
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
          title={confirmTitle}
          description={confirmDescription}
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

/**
 * The effect-only sibling of `BoundButton`: same gating and labeling, but the
 * click applies a declarative effect against the row instead of calling a
 * function — e.g. a "Review" action that opens the task's detail overlay where
 * the pending review card lives. A separate component (not a BoundButton
 * branch) so neither calls hooks conditionally.
 */
export function EffectButton({
  action,
  item,
  size = 'sm',
}: {
  action: EffectActionSpec;
  item?: Record<string, unknown>;
  size?: 'sm' | 'default';
}) {
  const { t } = useT('automations');
  const applyEffect = useActionEffect();

  if (item && action.when && !evaluateWhen(action.when, item)) return null;

  const label = action.labelKey
    ? t(action.labelKey, { defaultValue: action.label ?? action.effect.kind })
    : (action.label ?? action.effect.kind);

  return (
    <Button
      size={size}
      variant={action.variant ?? 'secondary'}
      onClick={() => applyEffect(action.effect, undefined, item)}
    >
      {label}
    </Button>
  );
}
