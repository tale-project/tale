import { Button } from '@tale/ui/button';
import { Dialog } from '@tale/ui/dialog/dialog';
import { Input } from '@tale/ui/input';
import { Text } from '@tale/ui/text';
import { useEffect, useId, useRef, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import type { TabInfo } from '@/lib/live-view';

import type { PageDialogInfo } from '../lib/live-state';
import { speakerOf } from '../lib/tab-label';

interface PageDialogsProps {
  dialogs: readonly PageDialogInfo[];
  tabs: readonly TabInfo[];
  /** Answers a dialog: accepted or not, and the text of a prompt. */
  onAnswer: (id: number, accept: boolean, text: string | null) => void;
  /** A dialog is gone: the keyboard goes back to the page. */
  returnFocus: () => void;
}

/**
 * The dialogs the page opens with `alert()`, `confirm()`, `prompt()` or
 * before it is left. The browser has no window to show them in, and the page
 * waits for the answer, so they are asked here, in the order they came, one
 * modal at a time: several modals at once would hide each other from assistive
 * technology. Closing one any other way than its buttons is the careful
 * answer: no.
 *
 * What the page says is the description of the dialog (a screen reader reads
 * it with the name, and a prompt's field is named by it). Who says it is the
 * host of the tab, never the title the page gave itself: a page can call
 * itself what it likes, but not where it is.
 */
export function PageDialogs({
  dialogs,
  tabs,
  onAnswer,
  returnFocus,
}: PageDialogsProps) {
  const [oldest] = dialogs;
  if (oldest === undefined) return null;
  return (
    <PageDialog
      key={oldest.id}
      dialog={oldest}
      tabs={tabs}
      onAnswer={onAnswer}
      returnFocus={returnFocus}
    />
  );
}

function PageDialog({
  dialog,
  tabs,
  onAnswer,
  returnFocus,
}: Omit<PageDialogsProps, 'dialogs'> & { dialog: PageDialogInfo }) {
  const { t } = useT('viewer');
  const { t: tCommon } = useT('common');
  const formId = useId();
  const messageId = useId();
  const okRef = useRef<HTMLButtonElement>(null);
  const [text, setText] = useState(dialog.default);
  const asks = dialog.kind === 'prompt';
  const leaving = dialog.kind === 'beforeunload';
  const tab = tabs.find((item) => item.id === dialog.tab);
  const speaker = tab === undefined ? null : speakerOf(tab.url);
  // A page that is left asks without saying what: the browser words it then.
  const message = dialog.message || (leaving ? t('dialog.leaveBody') : '');

  const answer = (accept: boolean) =>
    onAnswer(dialog.id, accept, asks ? text : null);

  // Enter answers a dialog that asks no text. The dialog moves the focus into
  // itself first; this comes after it.
  useEffect(() => {
    if (asks) return undefined;
    const timer = window.setTimeout(
      () => okRef.current?.focus({ preventScroll: true }),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [asks]);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) answer(false);
      }}
      title={leaving ? t('dialog.leaveTitle') : t('dialog.title')}
      description={
        message === '' ? undefined : (
          // The description is muted; what a page says is the point of the dialog.
          <span
            id={messageId}
            className="text-foreground block break-words whitespace-pre-wrap"
          >
            {message}
          </span>
        )
      }
      hideClose
      size="md"
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        returnFocus();
      }}
      footer={
        <>
          {dialog.kind !== 'alert' && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => answer(false)}
            >
              {leaving ? t('dialog.stay') : tCommon('actions.cancel')}
            </Button>
          )}
          <Button ref={okRef} type="submit" form={formId}>
            {leaving ? t('dialog.leave') : t('dialog.ok')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          answer(true);
        }}
      >
        {speaker !== null && <Text variant="caption">{speaker}</Text>}
        {asks && (
          <Input
            // The question names the field; "Answer" is for a page that asked nothing.
            aria-labelledby={message === '' ? undefined : messageId}
            aria-label={message === '' ? t('dialog.answer') : undefined}
            value={text}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setText(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
          />
        )}
      </form>
    </Dialog>
  );
}
