import { SubPanel, SubPanelHeader } from '@tale/ui/sub-panel';
import { useRef, useState } from 'react';

import { useT } from '@/lib/i18n/client';

import { AddSessionDialog } from './add-session-dialog';
import { SessionList } from './session-list';
import { SessionsHeaderActions } from './sessions-header-actions';

/**
 * The list of sessions beside the page, in the frame every section panel
 * shares: the section's name with its two actions in the `h-13` header, then
 * the rows. Below `md` the frame hides; the phone's Sessions screen shows the
 * same list on its own (see `SessionsIndexPage`).
 */
export function SessionsPanel() {
  const { t } = useT('sessions');
  const [adding, setAdding] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  return (
    <SubPanel as="nav" width="list" ariaLabel={t('panel.title')}>
      <SubPanelHeader
        title={t('panel.title')}
        actions={
          <SessionsHeaderActions
            onAdd={() => setAdding(true)}
            addButtonRef={addButton}
          />
        }
      />
      <SessionList
        onAdd={() => setAdding(true)}
        onFocusLost={() => addButton.current?.focus()}
      />
      {adding && (
        <AddSessionDialog
          open
          onOpenChange={setAdding}
          restoreFocusRef={addButton}
        />
      )}
    </SubPanel>
  );
}
