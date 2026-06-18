'use client';

/**
 * Renders a part's / row's ACTIONS as buttons — availability-as-DATA: only the
 * actions whose `when` predicate holds for the bound item are shown. It is
 * capability-agnostic: it never names a mutation, it just calls `onAction`
 * (the apps layer supplies the audited dispatch). Keeps the render-kind library
 * free of any apps/dispatch dependency.
 */
import { Button } from '@tale/ui/button';
import { HStack } from '@tale/ui/layout';

import { useT } from '@/lib/i18n/client';
import {
  type ActionKind,
  isActionKind,
} from '@/lib/shared/platform/action_kinds';
import { evaluateWhen } from '@/lib/shared/platform/when_predicate';
import type { ViewAction } from '@/lib/shared/schemas/views';

type BtnVariant = 'primary' | 'secondary' | 'destructive' | 'ghost';

const KIND_VARIANT: Record<ActionKind, BtnVariant> = {
  approve: 'primary',
  reject: 'destructive',
  respond: 'primary',
  trigger_workflow: 'primary',
  steer: 'secondary',
  assign: 'secondary',
  comment: 'ghost',
};

export function ActionBar({
  actions,
  item,
  onAction,
  isPending,
  size = 'sm',
}: {
  actions: ViewAction[];
  item: Record<string, unknown>;
  onAction: (action: ViewAction, item: Record<string, unknown>) => void;
  isPending?: boolean;
  size?: 'sm' | 'default';
}) {
  const { t } = useT('operator');
  const visible = actions.filter((a) => evaluateWhen(a.when, item));
  if (visible.length === 0) return null;

  return (
    <HStack gap={2} className="flex-wrap">
      {visible.map((action) => {
        const fallback = action.title
          ? action.title
          : t(`action.${action.kind}`, { defaultValue: action.kind });
        const label = action.labelKey
          ? t(action.labelKey, { defaultValue: fallback })
          : fallback;
        const variant: BtnVariant = isActionKind(action.kind)
          ? KIND_VARIANT[action.kind]
          : 'secondary';
        return (
          <Button
            key={action.id}
            size={size}
            variant={variant}
            disabled={isPending}
            onClick={() => {
              if (
                action.confirm &&
                // eslint-disable-next-line no-alert -- v1 confirm; a dialog is a polish follow-up
                !window.confirm(
                  t('action.confirm', { defaultValue: 'Are you sure?' }),
                )
              ) {
                return;
              }
              onAction(action, item);
            }}
          >
            {label}
          </Button>
        );
      })}
    </HStack>
  );
}
