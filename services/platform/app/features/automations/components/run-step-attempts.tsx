'use client';

import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Text } from '@tale/ui/text';

import type { RecordedStep } from '@/app/lib/backend/contract/automations';
import { useT } from '@/lib/i18n/client';

import { stepFailureText } from '../lib/run-failure';

/**
 * Each try of a step, when it took more than one or a restart cut one
 * short: how each ended and, for one that failed, why in the reader's
 * words.
 */
export function RunStepAttempts({ step }: { step: RecordedStep }) {
  const { t } = useT('automationRuns');
  const { locale } = useLocale();
  const attempts = step.attempts;
  if (
    attempts.length < 2 &&
    !attempts.some((attempt) => attempt.outcome === 'interrupted')
  ) {
    return null;
  }
  return (
    <section className="flex flex-col gap-1">
      <h4 className="text-xs font-medium">{t('attempts.title')}</h4>
      <ol className="flex flex-col gap-0.5 text-sm">
        {attempts.map((attempt) => {
          const why =
            attempt.reason === undefined
              ? undefined
              : stepFailureText(
                  {
                    code: attempt.failureCode ?? 'node_error',
                    reason: attempt.reason,
                    params: {},
                    message: '',
                  },
                  { t, locale },
                ).title;
          return (
            <li key={attempt.n} className="flex flex-wrap gap-x-2">
              <span className="font-medium">
                {t('attempts.row', { n: attempt.n })}
              </span>
              <span>{t(`attempts.outcome.${attempt.outcome}`)}</span>
              {why !== undefined && (
                <Text as="span" variant="muted" className="text-xs">
                  {why}
                </Text>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
