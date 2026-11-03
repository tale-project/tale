import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@tale/ui/adaptive-header';
import { EmptyState } from '@tale/ui/empty-state';
import { PageLayout } from '@tale/ui/page-layout';
import { useIsMobile } from '@tale/ui/use-is-mobile';
import { PanelLeft } from 'lucide-react';
import { useRef, useState } from 'react';

import { useMeta } from '@/app/hooks/use-meta';
import { useT } from '@/lib/i18n/client';

import { AddSessionDialog } from './add-session-dialog';
import { SessionList } from './session-list';
import { SessionsHeaderActions } from './sessions-header-actions';

/**
 * `/sessions`, where no session is open. Beside the panel it says so, and what
 * to do (choose one, or add the first); its header bar is empty to the eye, as
 * the panel's header has the name of the section. On a phone, which has no
 * panel, this page is the list: the whole screen, with its own header holding
 * the name of the section and the actions the panel's header would hold.
 */
export function SessionsIndexPage() {
  const { t } = useT('sessions');
  const isMobile = useIsMobile();
  const meta = useMeta();
  const [adding, setAdding] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);

  // Nothing is said about adding until the count is known, so the hint does
  // not change from "choose" to "add" a moment after it appeared.
  const hint =
    meta.data === undefined
      ? undefined
      : meta.data.counts.sessions === 0
        ? t('index.addFirst')
        : t('index.choose');

  return (
    <PageLayout
      className="overflow-hidden"
      header={
        <AdaptiveHeaderRoot showBorder standalone={false} className="gap-2">
          {/* Beside the panel, which shows the name of the section already, the
              page keeps it for assistive technology and for the page's one
              heading: a second "Sessions" in sight would only repeat it. On a
              phone there is no panel, and this is the only place that shows it. */}
          <AdaptiveHeaderTitle className={isMobile ? undefined : 'sr-only'}>
            {t('panel.title')}
          </AdaptiveHeaderTitle>
          {isMobile && (
            <div className="ml-auto flex items-center gap-1">
              <SessionsHeaderActions
                onAdd={() => setAdding(true)}
                addButtonRef={addButton}
              />
            </div>
          )}
        </AdaptiveHeaderRoot>
      }
    >
      {isMobile ? (
        <SessionList
          onAdd={() => setAdding(true)}
          onFocusLost={() => addButton.current?.focus()}
          headingLevel={2}
        />
      ) : (
        <EmptyState
          // Not the panel's glyph: the two empty states side by side would
          // repeat each other. This one points at the panel.
          icon={PanelLeft}
          headingLevel={2}
          title={t('index.title')}
          description={hint}
        />
      )}
      {adding && (
        <AddSessionDialog
          open
          onOpenChange={setAdding}
          restoreFocusRef={addButton}
        />
      )}
    </PageLayout>
  );
}
