'use client';

import { useFormatNumber } from '@/app/hooks/use-format-number';
import { TASK_DESCRIPTION_MAX } from '@/backend/core/tasks/helpers';
import { useT } from '@/lib/i18n/client';

/**
 * A description draft against the domain's cap ({@link TASK_DESCRIPTION_MAX}),
 * measured as a save sends it: trimmed, in UTF-16 code units. While the draft
 * is over, `hint` is the field's error — the cap in the reader's number
 * format, the same sentence a server refusal toasts
 * (`errors.TASK_DESCRIPTION_INVALID`) — and `counterMax` turns on the
 * field's own `used / max` counter, fed the same trimmed length
 * (`counterValue`) so surrounding whitespace never reads as over; the
 * caller holds its save until it fits:
 * the server refuses such a description, and the board used to show that
 * refusal as the generic error toast. An older import stored descriptions
 * whole past the cap, so an unchanged one can be over it too.
 *
 * The hint never carries the running length: the `Textarea` renders its
 * error in a live `role="alert"` region and shakes the field whenever the
 * sentence changes, so a length in it was re-announced on every keystroke.
 * The count lives in the counter, outside any live region; the alert
 * changes only when the draft crosses the cap.
 */
export function useDescriptionCap(draft: string): {
  overCap: boolean;
  hint: string | undefined;
  counterMax: number | undefined;
  counterValue: number;
} {
  const { t } = useT('tasks');
  const { formatNumber } = useFormatNumber();
  const length = draft.trim().length;
  const overCap = length > TASK_DESCRIPTION_MAX;
  return {
    overCap,
    hint: overCap
      ? t('errors.TASK_DESCRIPTION_INVALID', {
          max: formatNumber(TASK_DESCRIPTION_MAX),
        })
      : undefined,
    counterMax: overCap ? TASK_DESCRIPTION_MAX : undefined,
    counterValue: length,
  };
}
