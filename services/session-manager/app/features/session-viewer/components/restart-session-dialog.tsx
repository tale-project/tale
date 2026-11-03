import type { RefObject } from 'react';

import { ConfirmSessionActionDialog } from '@/app/features/sessions/components/confirm-session-action-dialog';
import { useSessionActions } from '@/app/features/sessions/hooks/use-session-actions';
import { settle } from '@/app/features/sessions/lib/settle';
import type { Session } from '@/lib/api/schemas';

interface RestartSessionDialogProps {
  session: Pick<Session, 'id' | 'name'>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where the keyboard goes back to when the control that asked has gone by then (a popover's button). */
  restoreFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * Asks before restarting a running session (its browser closes and opens
 * again), and restarts it when confirmed. The question stays open when the
 * restart is refused: the person is told once, as a toast, and can try again.
 * The page offers the restart in two places (the bar that warns the exit IP
 * changed, and the details of the session), each asking in this dialog.
 */
export function RestartSessionDialog({
  session,
  open,
  onOpenChange,
  restoreFocusRef,
}: RestartSessionDialogProps) {
  const { restart } = useSessionActions();

  const confirm = async () => {
    const result = await settle(restart.mutateAsync({ id: session.id }));
    if (result.ok) onOpenChange(false);
  };

  return (
    <ConfirmSessionActionDialog
      action="restart"
      session={session}
      open={open}
      onOpenChange={onOpenChange}
      isLoading={restart.isPending}
      onConfirm={() => void confirm()}
      restoreFocusRef={restoreFocusRef}
    />
  );
}
