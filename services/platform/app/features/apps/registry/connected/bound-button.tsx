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

import { useT } from '@/lib/i18n/client';
import type { FunctionMode } from '@/lib/shared/platform/function_bindings';
import { evaluateWhen } from '@/lib/shared/platform/when_predicate';

import { useBoundAction } from '../../hooks/use-bound-action';
import {
  type ActionEffect,
  useActionEffect,
} from '../../runtime/action-effects';

export interface BoundActionSpec {
  /** Literal button label (or use labelKey for the app's Tier-2 catalog). */
  label?: string;
  labelKey?: string;
  /** `<dir>/<file>:<export>` reference path (must be in capabilities.functions). */
  path: string;
  mode: FunctionMode;
  /** Args with templates: whole-string `$orgId` / `$selected` / `$selected.<field>`;
   *  embedded `$tpl:…{field}…` (row interpolation) / `$label:<key>` (localized
   *  pack template interpolated over the row). */
  args?: unknown;
  confirm?: boolean;
  /** Availability predicate over the bound item (when_predicate grammar). */
  when?: string;
  variant?: 'primary' | 'secondary' | 'destructive' | 'ghost';
  /** Declarative "then": an effect to run once the action resolves (e.g. open
   *  the created resource's detail). Reads the result via `$result.*`. */
  onSuccess?: ActionEffect;
  /** Predicate over the bound item; when true the action shows as a disabled
   *  "done" affordance instead of an active button (e.g. a row already acted on).
   *  For rows that carry the signal. */
  doneWhen?: string;
  /** Label for the "done" state. Its presence ALSO marks the action consume-once:
   *  after a successful run the button shows done for that row this session (for
   *  rows that carry no persistent signal, e.g. "Create task" on an issue). */
  doneLabelKey?: string;
  doneLabel?: string;
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

export function BoundButton({
  action,
  item,
  size = 'sm',
}: {
  action: BoundActionSpec;
  item?: Record<string, unknown>;
  size?: 'sm' | 'default';
}) {
  const { t } = useT('apps');
  const { dispatch, isPending } = useBoundAction(action.path, action.mode);
  const applyEffect = useActionEffect();
  // Consume-once feedback: a successful run leaves the row "done" for the session,
  // even when the row carries no persistent signal (e.g. a GitHub issue → task).
  const [justRan, setJustRan] = useState(false);

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

  const run = async () => {
    try {
      const result = await dispatch(action.args, item);
      applyEffect(action.onSuccess, result, item);
      // Only consume-once actions (those declaring a done label) latch to done.
      if (latchesOnRun) setJustRan(true);
    } catch (err) {
      // The mutation/action layer (useConvexMutation) already toasts + logs the
      // failure; surface it here too rather than swallowing the rejection.
      console.error('[app-binding] action failed', action.path, err);
    }
  };

  return (
    <Button
      size={size}
      variant={action.variant ?? 'secondary'}
      disabled={isPending}
      onClick={() => {
        if (
          action.confirm &&
          // eslint-disable-next-line no-alert -- v1 confirm; a dialog is a polish follow-up
          !window.confirm(t('confirm', { defaultValue: 'Are you sure?' }))
        ) {
          return;
        }
        void run();
      }}
    >
      {label}
    </Button>
  );
}
