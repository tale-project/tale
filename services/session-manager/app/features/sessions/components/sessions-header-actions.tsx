import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { IconButton } from '@tale/ui/icon-button';
import { Download, Ellipsis, Plus } from 'lucide-react';
import type { Ref } from 'react';

import { pendingIcon } from '@/app/lib/pending-icon';
import { useT } from '@/lib/i18n/client';

import { useBrowserBlock } from '../hooks/use-browser-block';
import { useSessionActions } from '../hooks/use-session-actions';
import { MENU_ITEM_WITH_NOTE, MenuLabel } from './menu-label';

interface SessionsHeaderActionsProps {
  /** Opens the dialog that adds a session. */
  onAdd: () => void;
  /** The "Add session" button, for whatever must hand the keyboard to it. */
  addButtonRef?: Ref<HTMLButtonElement>;
}

/**
 * What the head of the sessions list offers: add a session (not while the
 * browser is missing, and it says why), and a menu with the export of the
 * sessions' proxies, which is the one place the app hands out their passwords.
 */
export function SessionsHeaderActions({
  onAdd,
  addButtonRef,
}: SessionsHeaderActionsProps) {
  const { t } = useT('sessions');
  const browserBlock = useBrowserBlock();
  const { exportProxies } = useSessionActions();
  const exporting = exportProxies.isPending;

  const items = (): DropdownMenuGroup[] => [
    [
      {
        type: 'item',
        label: (
          <MenuLabel title={t('panel.export')} note={t('panel.exportNote')} />
        ),
        icon: Download,
        className: MENU_ITEM_WITH_NOTE,
        disabled: exporting,
        onClick: () => exportProxies.mutate(),
      },
    ],
  ];

  return (
    <>
      <IconButton
        ref={addButtonRef}
        icon={Plus}
        size="sm"
        aria-label={t('panel.add')}
        disabled={browserBlock !== null}
        disabledReason={browserBlock ?? undefined}
        onClick={onAdd}
      />
      <DropdownMenu
        align="end"
        contentClassName="w-64"
        trigger={
          <IconButton
            {...pendingIcon(exporting, Ellipsis)}
            size="sm"
            aria-label={t('panel.more')}
            aria-busy={exporting || undefined}
          />
        }
        items={items}
      />
    </>
  );
}
