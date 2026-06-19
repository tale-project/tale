'use client';

/**
 * The reusable action unit for connected blocks: a button bound to ONE
 * allowlisted Convex function. Availability is data (`when` over the bound item);
 * dispatch resolves arg templates (`$orgId` / `$selected*`) against the item.
 * Rendered once per (row × action), so the binding hook is called once per
 * instance — rules-of-hooks safe.
 */
import { Button } from '@tale/ui/button';

import { useT } from '@/lib/i18n/client';
import type { FunctionMode } from '@/lib/shared/platform/function_bindings';
import { evaluateWhen } from '@/lib/shared/platform/when_predicate';

import { useBoundAction } from '../../hooks/use-bound-action';

export interface BoundActionSpec {
  /** Literal button label (or use labelKey for the app's Tier-2 catalog). */
  label?: string;
  labelKey?: string;
  /** `<dir>/<file>:<export>` reference path (must be in capabilities.functions). */
  path: string;
  mode: FunctionMode;
  /** Args with templates: `$orgId`, `$selected`, `$selected.<field>`. */
  args?: unknown;
  confirm?: boolean;
  /** Availability predicate over the bound item (when_predicate grammar). */
  when?: string;
  variant?: 'primary' | 'secondary' | 'destructive' | 'ghost';
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

  if (item && action.when && !evaluateWhen(action.when, item)) return null;

  const label = action.labelKey
    ? t(action.labelKey, { defaultValue: action.label ?? action.path })
    : (action.label ?? action.path);

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
        void dispatch(action.args, item);
      }}
    >
      {label}
    </Button>
  );
}
