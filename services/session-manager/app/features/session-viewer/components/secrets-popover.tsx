import { Button } from '@tale/ui/button';
import { Popover } from '@tale/ui/popover';
import { KeyRound } from 'lucide-react';
import { useId, useRef, useState } from 'react';

import { SecretFormDialog } from '@/app/features/secrets/components/secret-form-dialog';
import { DEFAULT_KIND } from '@/app/features/secrets/lib/kinds';
import { useT } from '@/lib/i18n/client';

import { TOUCH_REACH } from '../lib/touch';
import { SecretsPanel } from './secrets-panel';

interface SecretsPopoverProps {
  sessionId: number;
  /** The name of the session, for the button that adds a secret for it. */
  sessionName: string;
  /** Types a value into the field that has the focus in the session's window. */
  onType: (text: string) => void;
}

/**
 * The secrets the session can use, to type into its window: the ones for this
 * session and the ones for every session, in groups by kind. A secret opens to
 * its values; a value is typed with one click into the field the person
 * clicked in the window, or copied. Masked values (passwords, card numbers)
 * stay dots until the person shows them.
 *
 * Its last button adds a secret for the session, in a form over the page: the
 * person stays on the page of the session.
 */
export function SecretsPopover({
  sessionId,
  sessionName,
  onType,
}: SecretsPopoverProps) {
  const { t } = useT('viewer');
  const headingId = useId();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  // A closed popover returns the keyboard to its button, also when a value was
  // chosen (the window it was typed into comes to the front); one closed to
  // add a secret hands it to the form, at once: a popover that is still fading
  // away must not keep the keyboard.
  const handedOver = useRef(false);

  return (
    <>
      <Popover
        open={open}
        onOpenChange={setOpen}
        side="bottom"
        align="start"
        contentClassName="flex w-96 max-w-[calc(100vw-1rem)] flex-col overflow-hidden p-0"
        aria-labelledby={headingId}
        onCloseAutoFocus={(event) => {
          if (!handedOver.current) return;
          handedOver.current = false;
          // The form has the keyboard: it is not taken back to the button.
          event.preventDefault();
        }}
        trigger={
          <Button
            ref={trigger}
            type="button"
            variant="secondary"
            icon={KeyRound}
            // Named after what it opens: the rail has a Secrets of its own, and
            // this is not it. The visible word is in the name (WCAG 2.5.3).
            aria-label={t('secrets.title')}
            className={TOUCH_REACH}
          >
            {t('secrets.button')}
          </Button>
        }
      >
        <SecretsPanel
          sessionName={sessionName}
          sessionId={sessionId}
          headingId={headingId}
          onType={(text) => {
            setOpen(false);
            onType(text);
          }}
          onAdd={() => {
            handedOver.current = true;
            setOpen(false);
            setAdding(true);
          }}
        />
      </Popover>
      {adding && (
        <SecretFormDialog
          target={{
            type: 'create',
            kind: DEFAULT_KIND,
            scope: String(sessionId),
            session: { id: sessionId, name: sessionName },
          }}
          onOpenChange={(next) => {
            if (!next) setAdding(false);
          }}
          // The button that opened the form went with the popover.
          restoreFocusRef={trigger}
        />
      )}
    </>
  );
}
