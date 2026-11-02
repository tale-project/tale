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
  /** The connection is not live: nothing can be typed. */
  disabled: boolean;
  /** Types a value into the page. */
  onType: (text: string) => void;
  /** A value was chosen: the keyboard goes back to the page. */
  returnFocus: () => void;
}

/**
 * The secrets the session can use, to type into the page: the ones for this
 * session and the ones for every session, in groups by kind. A secret opens to
 * its values; a value is typed with one click into the field the page has in
 * focus, or copied. Masked values (passwords, card numbers) stay dots until
 * the person shows them.
 *
 * Its last button adds a secret for the session, in a form over the page: the
 * person is not taken to the Secrets page, which would close the live view
 * they are typing into.
 */
export function SecretsPopover({
  sessionId,
  sessionName,
  disabled,
  onType,
  returnFocus,
}: SecretsPopoverProps) {
  const { t } = useT('viewer');
  const headingId = useId();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  // A closed popover returns the keyboard to its button; one closed by
  // choosing a value returns it to the page, where the value was typed, and
  // one closed to add a secret hands it to the form. The next place has it at
  // once: a popover that is still fading away must not keep the keyboard (a
  // quick Enter would type the value a second time).
  const handedOver = useRef(false);

  // The connection went: nothing can be typed, so the popover closes, and
  // stays closed when the connection comes back.
  const [wasDisabled, setWasDisabled] = useState(disabled);
  if (disabled !== wasDisabled) {
    setWasDisabled(disabled);
    if (disabled) setOpen(false);
  }

  return (
    <>
      <Popover
        open={open}
        onOpenChange={setOpen}
        side="bottom"
        align="end"
        contentClassName="flex w-96 max-w-[calc(100vw-1rem)] flex-col overflow-hidden p-0"
        aria-labelledby={headingId}
        onCloseAutoFocus={(event) => {
          if (!handedOver.current) return;
          handedOver.current = false;
          // The page or the form has the keyboard: it is not taken back to
          // the button.
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
            // A toolbar too narrow for the address to read (a window beside the
            // list of sessions, a phone) or a window too short for the chrome
            // keeps the key and drops the word, as the notices of the platform do.
            iconClassName="short-viewport:mr-0 @max-xl/toolbar:mr-0"
            disabled={disabled}
            className={TOUCH_REACH}
          >
            <span className="short-viewport:sr-only @max-xl/toolbar:sr-only">
              {t('secrets.button')}
            </span>
          </Button>
        }
      >
        <SecretsPanel
          sessionName={sessionName}
          sessionId={sessionId}
          headingId={headingId}
          onType={(text) => {
            handedOver.current = true;
            setOpen(false);
            returnFocus();
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
