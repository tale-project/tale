'use client';

// Canvas-level fixture that surfaces artifact run results, independent of
// which file the user has selected in the sidebar. The entry file's run
// renders as the primary panel (always visible when there is anything to
// show); other files' runs collapse into a "Outputs for other files"
// section below.
//
// Previously this lived inside `CanvasRunnableCodeRenderer` and was keyed
// by `activePath`, so switching to a sibling file made the entry's
// download chip disappear. Hoisting it to canvas-pane decouples the run
// display from sidebar selection.

import { useQuery } from 'convex/react';

import { CollapsibleDetails } from '@/app/components/ui/navigation/collapsible-details';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import {
  RunResultDetails,
  StatusBadge,
  hasAnythingToShow,
  isStale,
  type RunFileProjection,
} from './run-result-helpers';

interface RunResultPanelProps {
  artifactId: Id<'artifacts'>;
  artifactRevision: number;
  entryFile: string;
}

export function RunResultPanel({
  artifactId,
  artifactRevision,
  entryFile,
}: RunResultPanelProps) {
  const { t } = useT('chat');
  const runs: RunFileProjection[] | undefined = useQuery(
    api.artifacts.queries.listRunsPerFile,
    { artifactId },
  );
  if (runs === undefined || runs.length === 0) return null;

  // listRunsPerFile already orders entry-first, so the partition is a
  // simple index split.
  const entryRun = runs.find((r) => r.path === entryFile);
  const secondaryRuns = runs.filter((r) => r.path !== entryFile);

  // "Anything to show" gate per file. Stale runs still render — the badge
  // picks up a "Source edited" chip but the content stays visible, so the
  // user can review what their previous run produced even after editing
  // the source.
  const entryStale = isStale(entryRun, artifactRevision);
  const entryHasContent = hasAnythingToShow(entryRun);
  const visibleSecondaries = secondaryRuns
    .map((run) => ({
      run,
      stale: isStale(run, artifactRevision),
      hasContent: hasAnythingToShow(run),
    }))
    .filter((s) => s.hasContent);

  if (!entryHasContent && visibleSecondaries.length === 0) return null;

  return (
    <div className="border-border bg-muted/10 flex shrink-0 flex-col gap-4 overflow-auto border-b p-4">
      {entryHasContent && entryRun && (
        <RunResultDetails
          fileRun={entryRun}
          stale={entryStale}
          headerLabel={t('canvas.runResultEntryLabel')}
        />
      )}

      {visibleSecondaries.length > 0 && (
        <div className="flex flex-col gap-2">
          {/* Header doubles as a count chip; pluralised for L10n. */}
          <span className="text-muted-foreground text-xs font-medium uppercase">
            {t('canvas.runResultSecondaryCount', {
              count: visibleSecondaries.length,
            })}
          </span>
          {visibleSecondaries.map(({ run, stale }) => (
            <CollapsibleDetails
              key={String(run.executionId)}
              variant="compact"
              summary={
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate font-mono">
                    {t('canvas.runResultSecondaryLabel', { path: run.path })}
                  </span>
                  <StatusBadge
                    runStatus={run.runStatus}
                    runProgress={run.runProgress}
                    stale={stale}
                  />
                </span>
              }
            >
              <div className="mt-2 ml-5">
                <RunResultDetails
                  fileRun={run}
                  stale={stale}
                  showHeader={false}
                />
              </div>
            </CollapsibleDetails>
          ))}
        </div>
      )}
    </div>
  );
}
