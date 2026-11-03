import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import type { RefObject } from 'react';

import { useQuoted } from '@/app/hooks/use-quoted';
import type { Session } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

/** The two actions that close a running browser and open it again. */
export type ConfirmedSessionAction = 'restart' | 'rotate';

interface ConfirmSessionActionDialogProps {
  action: ConfirmedSessionAction;
  session: Pick<Session, 'name'>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The action is under way. */
  isLoading: boolean;
  onConfirm: () => void;
  /** Where the keyboard goes back to when the control that asked is gone by then (a popover's button). */
  restoreFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * Restarting, or switching to another proxy, closes the session's browser and
 * opens it again, so a running session asks first, and says what is kept.
 */
export function ConfirmSessionActionDialog({
  action,
  session,
  open,
  onOpenChange,
  isLoading,
  onConfirm,
  restoreFocusRef,
}: ConfirmSessionActionDialogProps) {
  const { t } = useT('sessions');
  const { quoted } = useQuoted();
  const name = quoted(session.name);
  const words = {
    restart: {
      title: t('restart.title', { name }),
      description: t('restart.description'),
      confirm: t('restart.confirm'),
    },
    rotate: {
      title: t('rotate.title', { name }),
      description: t('rotate.description'),
      confirm: t('rotate.confirm'),
    },
  }[action];

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={words.title}
      description={words.description}
      confirmText={words.confirm}
      isLoading={isLoading}
      onConfirm={onConfirm}
      restoreFocusRef={restoreFocusRef}
    />
  );
}
