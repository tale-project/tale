'use client';

import { Link } from '@tanstack/react-router';
import { RotateCcw } from 'lucide-react';

import type { RunReplayOf } from '@/app/lib/backend/contract/automations';
import { useT } from '@/lib/i18n/client';

import { shortRunId } from '../lib/run-view';

/**
 * Where a replay came from: the run it ran again, and how — as it ran,
 * with an edited input, or from one of its steps — with the way back to
 * that run. A run whose source was deleted says so.
 */
export function RunLineage({
  runId,
  replayOf,
  runsPath,
  stepLabel,
}: {
  /** The replay itself, compared with the run it ran again. */
  runId: string;
  replayOf: RunReplayOf;
  /** The automation's runs, where the source run's page hangs. */
  runsPath: string;
  /** How a reader names a step. */
  stepLabel: (nodeId: string) => string;
}) {
  const { t } = useT('automationRuns');
  const source = replayOf.runId;
  const id = source === null ? '' : shortRunId(source);
  const sourceHref: string = `${runsPath}/${source}`;
  const compareHref: string = `${runsPath}/compare`;
  const words =
    source === null
      ? t('lineage.deleted')
      : replayOf.kind === 'from' && replayOf.fromNode !== undefined
        ? t('lineage.from', { id, step: stepLabel(replayOf.fromNode) })
        : replayOf.kind === 'edited'
          ? t('lineage.edited', { id })
          : t('lineage.again', { id });
  return (
    <p className="text-muted-foreground flex basis-full flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <RotateCcw className="size-3.5 shrink-0" aria-hidden="true" />
      <span>{words}</span>
      {source !== null && (
        <Link
          to={sourceHref}
          className="text-foreground inline-flex min-h-6 items-center font-medium underline underline-offset-2"
        >
          {t('lineage.open', { id })}
        </Link>
      )}
      {source !== null && (
        <Link
          to={compareHref}
          search={{ a: source, b: runId }}
          className="text-foreground inline-flex min-h-6 items-center font-medium underline underline-offset-2"
        >
          {t('lineage.compare')}
        </Link>
      )}
    </p>
  );
}
