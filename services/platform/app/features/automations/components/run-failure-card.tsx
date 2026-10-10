'use client';

import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { IssueDetail } from '@tale/ui/issue-list';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight, CircleX, RotateCcw } from 'lucide-react';
import { useId } from 'react';

import { fieldOf } from '@/lib/engine/core/record/failure';
import type { StepFailure } from '@/lib/engine/core/record/types';
import { useT } from '@/lib/i18n/client';

import { fieldName } from '../lib/issue-text';
import {
  type FailureTextContext,
  runFailureText,
  stepFailureText,
} from '../lib/run-failure';

export interface RunFailureCardProps {
  /** Why the step the run failed at failed, when the run kept a record. */
  failure?: StepFailure;
  /** The step the run failed at, as the canvas names it. */
  stepLabel?: string;
  /** The run's failure code, for a run whose step left no reason. */
  code?: string;
  /** The engine's English, for the technical details only. */
  detail?: string;
  /** Names the catalog knows: connectors, actions, models, harnesses. */
  labels?: Omit<FailureTextContext, 't' | 'locale'>;
  /** The failed step in the editor, on the version the run ran. */
  editor?: { to: string; search: { node: string; version: number } };
  /** Selects the failed step on the canvas. */
  onShowStep?: () => void;
  /** Opens the retry from the failed step; left out when the reader may
   * not start runs. */
  onRetryFromStep?: () => void;
}

/**
 * The one place that says why a run failed: where it failed, what the
 * failure means, its concrete cause and the fix, in the reader's language —
 * the engine's English folded under technical details — with the ways on:
 * the failed step, the field in the editor, a retry from the step.
 */
export function RunFailureCard({
  failure,
  stepLabel,
  code,
  detail,
  labels,
  editor,
  onShowStep,
  onRetryFromStep,
}: RunFailureCardProps) {
  const { t } = useT('automationRuns');
  const { locale } = useLocale();
  const titleId = useId();
  const ctx: FailureTextContext = { ...labels, t, locale };
  const text =
    failure === undefined
      ? runFailureText(code, ctx)
      : stepFailureText(failure, ctx);
  const field =
    failure?.at === undefined ? undefined : fieldOf(failure.at.pointer);
  const technical = [
    failure?.message ?? detail,
    failure?.hint,
    [failure?.reason, failure?.code ?? code]
      .filter((part) => part !== undefined)
      .join(' · '),
  ].filter((line) => line !== undefined && line !== '');

  return (
    <section aria-labelledby={titleId}>
      <Card
        padding="md"
        className="border-destructive/40 bg-destructive/[0.04] dark:bg-destructive/10 flex flex-col gap-3"
      >
        <div className="flex items-center gap-2">
          <CircleX
            className="text-destructive size-5 shrink-0"
            aria-hidden="true"
          />
          <Text as="h3" id={titleId} className="text-sm font-semibold">
            {stepLabel === undefined
              ? t('failure.titleRun')
              : t('failure.title', { step: stepLabel })}
          </Text>
        </div>
        <Text as="p" className="text-sm font-medium">
          {text.title}
        </Text>
        <IssueDetail
          className="p-0"
          issue={{
            id: titleId,
            severity: 'error',
            title: text.title,
            explanation: text.explanation,
            ...(text.cause !== '' && { cause: text.cause }),
            fix: text.fix,
            ...(technical.length > 0 && {
              technical: technical.join('\n'),
            }),
          }}
        />
        {stepLabel !== undefined &&
          (field !== undefined || editor !== undefined) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {field !== undefined && field !== '' && (
                <Text as="span" variant="muted" className="text-xs">
                  {t('failure.location', {
                    step: stepLabel,
                    field: fieldName(t, field),
                  })}
                </Text>
              )}
              {editor !== undefined && (
                <Link
                  to={editor.to}
                  search={editor.search}
                  className="text-foreground inline-flex min-h-6 items-center gap-1 text-xs font-medium underline underline-offset-2"
                >
                  {t('failure.showInEditor')}
                  <ArrowUpRight className="size-3.5" aria-hidden="true" />
                </Link>
              )}
            </div>
          )}
        {(onShowStep !== undefined || onRetryFromStep !== undefined) && (
          <div className="flex flex-wrap gap-2">
            {onShowStep !== undefined && (
              <Button variant="secondary" size="sm" onClick={onShowStep}>
                {t('failure.showStep')}
              </Button>
            )}
            {onRetryFromStep !== undefined && (
              <Button
                variant="secondary"
                size="sm"
                icon={RotateCcw}
                onClick={onRetryFromStep}
              >
                {t('failure.retry')}
              </Button>
            )}
          </div>
        )}
      </Card>
    </section>
  );
}
