'use client';

import { Text } from '@tale/ui/text';
import { ShieldAlert } from 'lucide-react';
import { useRef } from 'react';

import { useT } from '@/lib/i18n/client';

import { useShownDataNotice } from '../hooks/use-shown-data-notice';

interface DataNoticeInlineProps {
  organizationId: string | undefined;
}

/** What can take focus inside a message row. */
const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * Hand focus to the last control of the message `note` sits in, outside the
 * note — the reply's toolbar, or the edit pencil of a message of yours.
 */
function focusRowControl(note: HTMLElement): void {
  const controls = Array.from(
    note.closest('li')?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
  ).filter((control) => !note.contains(control));
  controls.at(-1)?.focus();
}

/**
 * The confidentiality notice on a conversation's last message (see
 * MessageThread's `dataNotice`): the org's text under the newest reply, with
 * a "Don't show again" action that hides it from this member
 * (`useShownDataNotice`). Before a conversation has a message, and beside an
 * arena pair, the notice sits under the composer instead (`DataNoticeFooter`).
 *
 * It reads its own state, so neither the policy read nor a dismissal
 * re-renders the message around it.
 */
export function DataNoticeInline({ organizationId }: DataNoticeInlineProps) {
  const { t } = useT('dataNotice');
  const notice = useShownDataNotice(organizationId);
  const noteRef = useRef<HTMLDivElement>(null);

  if (notice.message === null) return null;

  const handleDismiss = () => {
    // The action leaves with the note: focus moves to the message's own
    // controls, so a keyboard reader keeps their place in the transcript
    // instead of starting over from the top of the page.
    if (noteRef.current !== null) focusRowControl(noteRef.current);
    notice.dismiss();
  };

  return (
    <div
      ref={noteRef}
      role="note"
      aria-label={t('ariaLabel', 'Confidentiality notice')}
      // The note moves to the newest message after every reply; arriving
      // there is no new entry for the transcript's live log to announce.
      aria-live="off"
      className="text-muted-foreground mt-2 flex items-start gap-1.5"
    >
      <ShieldAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
      <Text variant="caption" className="min-w-0 leading-tight">
        {notice.message}{' '}
        <button
          type="button"
          onClick={handleDismiss}
          // Underlined at rest: beside the muted text its color alone is too
          // faint a cue in the dark theme. The `after` box stretches the
          // small text to a 24px hit target without moving it.
          className="text-foreground focus-visible:ring-ring relative rounded-sm whitespace-nowrap underline underline-offset-2 after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-[''] focus-visible:ring-2 focus-visible:outline-none"
        >
          {t('inline.dismiss', "Don't show again")}
        </button>
      </Text>
    </div>
  );
}
