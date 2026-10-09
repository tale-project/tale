import { useFormatDate } from '@tale/ui/use-format-date';
import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';

import {
  cronPatternText,
  type CronPreview,
  previewCronExpression,
} from '../lib/cron-preview';

/**
 * The words under a Cron field — one hook for every surface that takes a
 * schedule (the trigger panel, the blank-automation wizard), so they judge
 * with the same validator and say the same things:
 *
 * - `description`: the hint while empty, the generic refusal while invalid,
 *   otherwise the recognised pattern ("Every 5 minutes") and the next run;
 * - `invalidText`: the refusal to put in the field's error slot — the
 *   validator's own sentence when it has one, the same the save answers.
 *
 * `active` false (the field is not a schedule right now) answers no
 * description at all.
 */
export function useCronPreview(
  cron: string,
  timezone: string,
  active = true,
): {
  preview: CronPreview;
  description: string | undefined;
  invalidText: string | undefined;
  /** The recognised pattern alone ("Every 5 minutes"), when there is one. */
  pattern: string | undefined;
} {
  const { t } = useT('automations');
  const { formatDate } = useFormatDate();

  const preview = useMemo(
    () => previewCronExpression(cron, timezone || 'UTC'),
    [cron, timezone],
  );

  const invalidText =
    preview.kind === 'invalid'
      ? preview.reason === undefined
        ? t('trigger.cronInvalid')
        : t('trigger.cronInvalidReason', { reason: preview.reason })
      : undefined;

  const pattern = useMemo(
    () =>
      preview.kind === 'ok' ? cronPatternText(preview.pattern, t) : undefined,
    [preview, t],
  );

  const description = useMemo(() => {
    if (!active) return undefined;
    if (preview.kind === 'empty') return t('trigger.cronHint');
    if (preview.kind === 'invalid') return t('trigger.cronInvalid');
    const next = t('trigger.cronNext', {
      at: formatDate(preview.nextAt, 'long'),
    });
    return pattern === undefined ? next : `${pattern} · ${next}`;
  }, [active, preview, pattern, t, formatDate]);

  return { preview, description, invalidText, pattern };
}
