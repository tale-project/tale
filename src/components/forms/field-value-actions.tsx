'use client';

import { useT } from '@tale/ui/i18n/client';
import { Tooltip } from '@tale/ui/tooltip';
import { useCopy } from '@tale/ui/use-copy';
import { Check, Copy, Eye, EyeOff } from 'lucide-react';

/**
 * The words of a reveal toggle when "Show password" does not say what is
 * revealed: a card number, a token, a recovery code. The label names the
 * action the button would do now, so the two swap as it is pressed.
 */
export interface RevealLabels {
  show: string;
  hide: string;
}

/**
 * The buttons a field carries inside its own border: reveal a masked value,
 * copy it. A glyph in a 24px box (the WCAG 2.5.8 floor), and under a coarse
 * pointer a 44px target: the box grows by an invisible ring and the buttons
 * move apart, so a thumb meant for one does not land on the other. A button
 * takes the pointer itself (`pointer-events-auto`): the box it sits in does
 * not, see `FIELD_ACTIONS_END`.
 */
const FIELD_ACTION =
  "text-muted-foreground hover:text-foreground focus-visible:ring-ring pointer-events-auto relative inline-flex size-6 shrink-0 items-center justify-center rounded-md transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none pointer-coarse:after:absolute pointer-coarse:after:-inset-2.5 pointer-coarse:after:content-['']";

/**
 * Where the buttons sit in a field: on its right edge, centred on its height,
 * over the room the control keeps free for them (see `fieldActionsRoom`). The
 * box lies over the field and takes no pointer of its own, so a click beside a
 * button (above or below it, or in the gap between two) still reaches the field
 * and focuses it.
 */
export const FIELD_ACTIONS_END =
  'pointer-events-none absolute inset-y-0 right-2 flex items-center gap-0.5 pointer-coarse:gap-5';

/** Where a multi-line control carries them: its top-right corner. Takes no pointer either. */
export const FIELD_ACTIONS_CORNER =
  'pointer-events-none absolute top-1.5 right-2 flex items-center gap-0.5 pointer-coarse:gap-5';

/** The right padding a control keeps for `count` buttons, so its text never runs under them. */
export function fieldActionsRoom(count: number): string | undefined {
  if (count <= 0) return undefined;
  return count === 1 ? 'pr-10' : 'pr-16 pointer-coarse:pr-[5.25rem]';
}

interface RevealToggleProps {
  revealed: boolean;
  onToggle: () => void;
  labels: RevealLabels;
}

/** The eye of a masked field: shows the value, hides it again. */
export function RevealToggle({
  revealed,
  onToggle,
  labels,
}: RevealToggleProps) {
  const name = revealed ? labels.hide : labels.show;
  return (
    <Tooltip content={name}>
      <button
        type="button"
        aria-label={name}
        aria-pressed={revealed}
        className={FIELD_ACTION}
        onClick={onToggle}
      >
        {revealed ? (
          <EyeOff className="size-4" aria-hidden="true" />
        ) : (
          <Eye className="size-4" aria-hidden="true" />
        )}
      </button>
    </Tooltip>
  );
}

interface CopyValueButtonProps {
  /** Reads what to copy at the moment of the click: a field's value is not the caller's state. */
  getValue: () => string;
  /** The button's name (default "Copy"). */
  label?: string;
  /** What is read out once the value is on the clipboard (default "Copied"). */
  copiedLabel?: string;
  /** How long the check mark stays, in ms (default 2000). */
  copiedDuration?: number;
  /** Called once the value is on the clipboard. */
  onCopy?: () => void;
  /** Called when the browser refused (the toast is raised either way). */
  onCopyError?: (error: Error) => void;
}

/**
 * The copy button of a field. The value goes to the clipboard whether or not
 * it is shown, and is never put on the page by doing so. The glyph turns into
 * a check for a moment and a status region says it to a screen reader; when
 * the browser refuses, `useCopy` raises its toast and nothing is claimed.
 * Nothing is copied from an empty field.
 */
export function CopyValueButton({
  getValue,
  label,
  copiedLabel,
  copiedDuration,
  onCopy,
  onCopyError,
}: CopyValueButtonProps) {
  const { t } = useT('common');
  const { copied, copy } = useCopy({
    copiedDuration,
    onSuccess: onCopy,
    onError: onCopyError,
  });
  const name = label ?? t('actions.copy');
  return (
    <>
      <Tooltip content={name}>
        <button
          type="button"
          aria-label={name}
          className={FIELD_ACTION}
          onClick={() => {
            const value = getValue();
            if (value !== '') void copy(value);
          }}
        >
          {copied ? (
            <Check
              className="size-4 text-green-600 dark:text-green-400"
              aria-hidden="true"
            />
          ) : (
            <Copy className="size-4" aria-hidden="true" />
          )}
        </button>
      </Tooltip>
      <span role="status" className="sr-only">
        {copied ? (copiedLabel ?? t('actions.copied')) : ''}
      </span>
    </>
  );
}
