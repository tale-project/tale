'use client';

import { useFormatNumber } from '@/app/hooks/use-format-number';
import { TASK_DESCRIPTION_MAX } from '@/backend/core/tasks/helpers';
import { useT } from '@/lib/i18n/client';

/**
 * A description draft against the domain's cap ({@link TASK_DESCRIPTION_MAX}),
 * measured as a save sends it: trimmed, in UTF-16 code units. `hint` is the
 * field's sentence while the draft is over — its length and the cap, in the
 * reader's number format — and the caller holds its save until it fits: the
 * server refuses such a description, and the board used to show that
 * refusal as the generic error toast. An older import stored descriptions
 * whole past the cap, so an unchanged one can be over it too.
 */
export function useDescriptionCap(draft: string): {
  overCap: boolean;
  hint: string | undefined;
} {
  const { t } = useT('tasks');
  const { formatNumber } = useFormatNumber();
  const length = draft.trim().length;
  const overCap = length > TASK_DESCRIPTION_MAX;
  return {
    overCap,
    hint: overCap
      ? t('fields.descriptionTooLong', {
          length: formatNumber(length),
          max: formatNumber(TASK_DESCRIPTION_MAX),
        })
      : undefined,
  };
}
