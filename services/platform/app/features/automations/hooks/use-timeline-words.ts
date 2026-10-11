import { useLocale } from '@tale/ui/i18n/locale-provider';
import { useMemo } from 'react';

import type { WaitRecord } from '@/lib/engine/core/record/types';
import { useT } from '@/lib/i18n/client';

import { nodeTitle } from '../lib/node-face';
import { stepFailureText } from '../lib/run-failure';
import { substituteOf } from '../lib/run-overlay';
import type { TimelineWords } from '../lib/run-timeline';
import { benchMarkOf } from '../lib/run-view';

/** The catalog's names for a connector and an action, as a failure's
 * words name them. */
export interface FailureLabels {
  connectorLabel: (slug: string) => string;
  actionLabel: (type: string) => string;
}

/**
 * What a run's playback says about a step that failed or produced
 * nothing, about a wait, and about a step a test stood in for — in the
 * reader's language. The run page and the editor's try of the draft play
 * runs back with the same words.
 */
export function useTimelineWords(labels: FailureLabels): TimelineWords {
  const { t: tRuns } = useT('automationRuns');
  const { t } = useT('automations');
  const { locale } = useLocale();
  return useMemo<TimelineWords>(() => {
    const waits: Readonly<Record<WaitRecord['kind'], string>> = {
      approval: tRuns('playback.wait.approval'),
      ask: tRuns('playback.wait.ask'),
      room: tRuns('playback.wait.room'),
      repeat: tRuns('playback.wait.repeat'),
      in_doubt: tRuns('playback.wait.in_doubt'),
    };
    return {
      failed: (step) =>
        step.failure === undefined
          ? undefined
          : stepFailureText(step.failure, {
              t: tRuns,
              locale,
              ...labels,
            }).title,
      skipped: (step) => {
        const via = step.skip?.via?.[0];
        switch (step.skip?.reason) {
          case 'when':
            return tRuns('playback.reason.when');
          case 'else':
            return via === undefined
              ? tRuns('playback.reason.when')
              : tRuns('playback.reason.else', { partner: nodeTitle(via) });
          case 'upstream':
            return via === undefined
              ? undefined
              : tRuns('playback.reason.upstream', { via: nodeTitle(via) });
          case 'error':
            return tRuns('playback.reason.error');
          default:
            return undefined;
        }
      },
      wait: (wait) => waits[wait.kind],
      substitute: (step) => {
        const mark = benchMarkOf(step.meta.bench);
        return mark === undefined ? undefined : substituteOf(mark, t);
      },
    };
  }, [tRuns, t, locale, labels]);
}
