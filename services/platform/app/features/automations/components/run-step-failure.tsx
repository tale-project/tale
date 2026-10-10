'use client';

import { Alert } from '@tale/ui/alert';
import { useLocale } from '@tale/ui/i18n/locale-provider';

import type { RecordedStep } from '@/app/lib/backend/contract/automations';
import { useT } from '@/lib/i18n/client';

import { stepFailureText } from '../lib/run-failure';

/** Why one step failed, in the reader's words: what went wrong and its
 *  concrete case. The run's failure card carries the fix and the ways on. */
export function RunStepFailure({
  failure,
}: {
  failure: NonNullable<RecordedStep['failure']>;
}) {
  const { t } = useT('automationRuns');
  const { locale } = useLocale();
  const text = stepFailureText(failure, { t, locale });
  return (
    <Alert
      variant="destructive"
      title={text.title}
      description={text.cause === '' ? text.explanation : text.cause}
    />
  );
}
