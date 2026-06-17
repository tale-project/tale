'use client';

import { Alert } from '@tale/ui/alert';

import { useT } from '@/lib/i18n/client';

export interface TestResult {
  ok: boolean;
  kind:
    | 'pass'
    | 'modified'
    | 'flagged'
    | 'blocked'
    | 'step_error'
    | 'not_configured';
  categoryIds?: string[];
  matchCount?: number;
  httpStatus?: number;
  durationMs?: number;
  errorClass?:
    | 'timeout'
    | 'network'
    | 'parse'
    | 'http_4xx'
    | 'http_5xx'
    | 'config'
    | 'unknown';
  circuitOpened?: boolean;
  hint?: string;
}

export function TestResultView({ result }: { result: TestResult }) {
  const { t } = useT('governance');
  // `Alert` supports: 'default' | 'warning' | 'destructive'. A passing test
  // (no category hits) renders as 'default' — neutral, not green.
  const variant: 'default' | 'warning' | 'destructive' =
    result.kind === 'step_error' || result.kind === 'not_configured'
      ? 'destructive'
      : result.kind === 'blocked' ||
          result.kind === 'flagged' ||
          result.kind === 'modified'
        ? 'warning'
        : 'default';
  const title =
    result.kind === 'pass'
      ? t('moderationProvider.testPass')
      : result.kind === 'flagged'
        ? t('moderationProvider.testFlagged')
        : result.kind === 'blocked'
          ? t('moderationProvider.testBlocked')
          : result.kind === 'modified'
            ? t('moderationProvider.testModified')
            : result.kind === 'not_configured'
              ? t('moderationProvider.testNotConfigured')
              : t('moderationProvider.testStepError', {
                  errorClass: result.errorClass ?? 'unknown',
                });
  return (
    <Alert variant={variant} title={title}>
      <dl className="mt-2 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-xs">
        {result.httpStatus !== undefined && (
          <>
            <dt className="text-muted-foreground">
              {t('moderationProvider.testResultHttpStatus')}
            </dt>
            <dd className="tabular-nums">{result.httpStatus}</dd>
          </>
        )}
        {result.durationMs !== undefined && (
          <>
            <dt className="text-muted-foreground">
              {t('moderationProvider.testResultDuration')}
            </dt>
            <dd className="tabular-nums">
              {t('moderationProvider.testResultDurationValue', {
                ms: result.durationMs,
              })}
            </dd>
          </>
        )}
        {result.categoryIds && result.categoryIds.length > 0 && (
          <>
            <dt className="text-muted-foreground">
              {t('moderationProvider.testResultMatched')}
            </dt>
            <dd>{result.categoryIds.join(', ')}</dd>
          </>
        )}
        {result.matchCount !== undefined && result.matchCount > 0 && (
          <>
            <dt className="text-muted-foreground">
              {t('moderationProvider.testResultMatchCount')}
            </dt>
            <dd className="tabular-nums">{result.matchCount}</dd>
          </>
        )}
        {result.circuitOpened && (
          <>
            <dt className="text-muted-foreground">
              {t('moderationProvider.testResultCircuit')}
            </dt>
            <dd className="text-amber-700">
              {t('moderationProvider.testResultCircuitOpened')}
            </dd>
          </>
        )}
      </dl>
      {result.hint && <p className="mt-2 text-xs">{result.hint}</p>}
    </Alert>
  );
}
