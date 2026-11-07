import { cn } from '@tale/ui/cn';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { IconButton } from '@tale/ui/icon-button';
import {
  AppWindow,
  Ellipsis,
  MapPin,
  Pencil,
  RotateCw,
  Shuffle,
  Trash2,
} from 'lucide-react';
import { useRef, useState } from 'react';

import { pendingIcon } from '@/app/lib/pending-icon';
import { sessionIsBusy } from '@/app/lib/polling';
import type { Session } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

import { useCheckIp } from '../hooks/use-check-ip';
import { useProxyFlow } from '../hooks/use-proxy-flow';
import { useSessionActions } from '../hooks/use-session-actions';
import { settle } from '../lib/settle';
import { ConfirmSessionActionDialog } from './confirm-session-action-dialog';
import { DeleteSessionDialog } from './delete-session-dialog';
import { MENU_ITEM_WITH_NOTE, MenuLabel } from './menu-label';
import { RenameSessionDialog } from './rename-session-dialog';

export interface SessionActionsMenuProps {
  session: Session;
  /** Called once the session has been deleted (the page of a deleted session leaves it). */
  onDeleted?: () => void;
}

type MenuDialog = 'rename' | 'restart' | 'rotate' | 'delete';

/** A disabled item that says why keeps its words readable. */
const DISABLED_WITH_REASON =
  'data-disabled:opacity-100 data-disabled:text-muted-foreground';

/**
 * The "more actions" menu of a session (Show window, Rename, Restart, Rotate
 * IP, Check IP, Delete, each with its dialog), shared by a row of the sessions
 * panel and the header of a session's page. Start and Stop are separate
 * buttons. An action that cannot be done now says why in the menu; one under
 * way shows on the button that opened the menu.
 */
export function SessionActionsMenu({
  session,
  onDeleted,
}: SessionActionsMenuProps) {
  const { t } = useT('sessions');
  const { t: tCommon } = useT('common');
  const { restart, show } = useSessionActions();
  const checkIp = useCheckIp();
  const flow = useProxyFlow();
  const [dialog, setDialog] = useState<MenuDialog | null>(null);
  // The button that opened the menu: where the keyboard goes back to when the
  // dialog that asks for proxies is given up, the question and the menu having
  // closed by then.
  const trigger = useRef<HTMLButtonElement | null>(null);

  const running = session.status === 'running';
  const busy = sessionIsBusy(session);
  const rotating = flow.isRotating(session.id);
  const pending = restart.isPending || rotating || checkIp.isPending;

  const showReason = !running ? t('menu.showWindowOnlyRunning') : undefined;
  const restartReason = !running
    ? t('menu.restartOnlyRunning')
    : busy
      ? t('block.busy')
      : undefined;
  const rotateReason = busy ? t('menu.rotateBusy') : undefined;
  const checkIpReason = !running
    ? t('menu.checkIpOnlyRunning')
    : session.proxy === null
      ? t('menu.checkIpNoProxy')
      : undefined;

  const closeDialog = (open: boolean) => {
    if (!open) setDialog(null);
  };

  const confirmRestart = async () => {
    const result = await settle(restart.mutateAsync({ id: session.id }));
    if (result.ok) setDialog(null);
  };

  // The proxy flow asks for what a rotation lacks (proxies to give), in its
  // own dialog: this question gives way to it. A refusal of another kind was
  // told as a toast, and the question stays.
  const rotateNow = async () => {
    const attempt = await flow.rotate(session, {
      returnFocusTo: trigger.current,
    });
    if (attempt.kind !== 'refused') setDialog(null);
  };

  // Built when the menu opens: every row of the list carries one.
  const items = (): DropdownMenuGroup[] => [
    [
      {
        type: 'item',
        label: <MenuLabel title={t('menu.showWindow')} note={showReason} />,
        icon: AppWindow,
        disabled: showReason !== undefined,
        className: cn(
          showReason !== undefined && MENU_ITEM_WITH_NOTE,
          showReason !== undefined && DISABLED_WITH_REASON,
        ),
        onClick: () => show.mutate({ id: session.id }),
      },
    ],
    [
      {
        type: 'item',
        label: t('menu.rename'),
        icon: Pencil,
        disabled: pending,
        onClick: () => setDialog('rename'),
      },
      {
        type: 'item',
        label: <MenuLabel title={t('menu.restart')} note={restartReason} />,
        icon: RotateCw,
        disabled: pending || restartReason !== undefined,
        className: cn(
          restartReason !== undefined && MENU_ITEM_WITH_NOTE,
          restartReason !== undefined && DISABLED_WITH_REASON,
        ),
        onClick: () => setDialog('restart'),
      },
      {
        type: 'item',
        label: (
          <MenuLabel
            title={t('menu.rotate')}
            note={rotateReason ?? t('menu.rotateEffect')}
          />
        ),
        icon: Shuffle,
        disabled: pending || rotateReason !== undefined,
        className: cn(
          MENU_ITEM_WITH_NOTE,
          rotateReason !== undefined && DISABLED_WITH_REASON,
        ),
        // A running session's browser restarts: ask first. A stopped one loses
        // nothing by getting another proxy.
        onClick: () => {
          if (running) setDialog('rotate');
          else void rotateNow();
        },
      },
      {
        type: 'item',
        label: <MenuLabel title={t('menu.checkIp')} note={checkIpReason} />,
        icon: MapPin,
        disabled: pending || checkIpReason !== undefined,
        className: cn(
          checkIpReason !== undefined && MENU_ITEM_WITH_NOTE,
          checkIpReason !== undefined && DISABLED_WITH_REASON,
        ),
        onClick: () => checkIp.check(session.id),
      },
    ],
    [
      {
        type: 'item',
        label: tCommon('actions.delete'),
        icon: Trash2,
        destructive: true,
        disabled: pending,
        onClick: () => setDialog('delete'),
      },
    ],
  ];

  return (
    <>
      <DropdownMenu
        align="end"
        contentClassName="w-64"
        trigger={
          <IconButton
            ref={trigger}
            {...pendingIcon(pending, Ellipsis)}
            size="sm"
            aria-label={t('row.menu', { name: session.name })}
            aria-busy={pending || undefined}
          />
        }
        items={items}
      />
      {dialog === 'rename' && (
        <RenameSessionDialog
          session={session}
          open
          onOpenChange={closeDialog}
        />
      )}
      {(dialog === 'restart' || dialog === 'rotate') && (
        <ConfirmSessionActionDialog
          action={dialog}
          session={session}
          open
          onOpenChange={closeDialog}
          isLoading={dialog === 'restart' ? restart.isPending : rotating}
          onConfirm={() =>
            void (dialog === 'restart' ? confirmRestart() : rotateNow())
          }
        />
      )}
      {dialog === 'delete' && (
        <DeleteSessionDialog
          session={session}
          open
          onOpenChange={closeDialog}
          onDeleted={onDeleted}
        />
      )}
    </>
  );
}
