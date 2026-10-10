'use client';

import type {
  MissedSummary,
  TriggerSkipDetail,
  TriggerView,
} from '@tale/shared/schemas/automation-trigger';
import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { InlineCode } from '@tale/ui/inline-code';
import { SKELETON_PULSE } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import type { ReactNode } from 'react';

import { PERMANENT_FAILURES_BEFORE_PAUSE } from '@/backend/core/automations/failure';
import { useT } from '@/lib/i18n/client';

import { useAutomationRun } from '../hooks/queries';
import { RunBadge } from './run-status-badge';
import {
  TriggerEditorLink,
  type TriggerPlace,
  TriggerRunLink,
} from './trigger-links';

/** What the section's notices can ask the page to do. */
export interface TriggerHealthActions {
  /** Move focus to the schedule field. */
  editSchedule: () => void;
  /** Move focus to the Projects field. */
  editProjects: () => void;
  /** Fill the fixed input with the fields the inputs require and focus it;
   * absent when the fixed input could not fix the refusal. */
  fillMissing?: { count: number; run: () => void };
}

/**
 * How the trigger is doing: the last run it started with that run's state,
 * why it last started nothing — newer than its last start — in words with
 * the fix and a way there, and the failure streak that pauses a schedule.
 */
export function TriggerHealth({
  place,
  trigger,
  actions,
}: {
  place: TriggerPlace;
  trigger: TriggerView;
  actions: TriggerHealthActions;
}) {
  return (
    <div className="flex flex-col gap-3">
      <LastRunLine place={place} trigger={trigger} />
      <SkipNotice place={place} trigger={trigger} actions={actions} />
      <TriggerFailureNotice place={place} trigger={trigger} />
    </div>
  );
}

/** "Last run Mon, Oct 12, 9:00 AM · Succeeded · View run", or that the
 * trigger has not started a run yet. */
function LastRunLine({
  place,
  trigger,
}: {
  place: TriggerPlace;
  trigger: TriggerView;
}) {
  const { t } = useT('automations');
  const { formatDate } = useFormatDate();
  const runId = trigger.lastRunId ?? undefined;
  const run = useAutomationRun(place.organizationId, runId);
  if (trigger.lastFiredAt == null) {
    return (
      <Text as="p" variant="muted" className="text-xs">
        {t('trigger.health.noRunYet')}
      </Text>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <Text as="span" variant="muted" className="text-xs">
        {t('trigger.health.lastRun', {
          at: formatDate(new Date(trigger.lastFiredAt), 'long'),
        })}
      </Text>
      {runId !== undefined &&
        (run.isPending ? (
          <span
            aria-hidden="true"
            className={`inline-block h-5 w-20 rounded-md ${SKELETON_PULSE}`}
          />
        ) : run.data ? (
          <RunBadge status={run.data.status} stalled={run.data.stalled} />
        ) : null)}
      {runId !== undefined && (
        <TriggerRunLink place={place} runId={runId}>
          {t('trigger.failures.viewRun')}
        </TriggerRunLink>
      )}
    </div>
  );
}

/** The codes a project refuses a start with. */
const PROJECT_CODES: ReadonlySet<string> = new Set([
  'PROJECT_ARCHIVED',
  'AUTOMATION_PROJECT_UNKNOWN',
  'AUTOMATION_PROJECT_FORBIDDEN',
  'AUTOMATION_PROJECT_SCOPE_REQUIRED',
]);

/** The raw facts of a skip, in English, for whoever needs them. */
function TechnicalDetails({ rows }: { rows: Array<[string, ReactNode]> }) {
  const { t } = useT('automations');
  if (rows.length === 0) return null;
  return (
    <CollapsibleDetails
      variant="compact"
      summary={t('trigger.skip.technicalDetails')}
    >
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {rows.map(([term, value], index) => (
          // Two issues can name one field.
          <div key={`${term}-${index}`} className="contents">
            <dt className="text-muted-foreground font-mono">{term}</dt>
            <dd className="min-w-0 break-words">{value}</dd>
          </div>
        ))}
      </dl>
    </CollapsibleDetails>
  );
}

/**
 * Why the trigger last started nothing, when that is newer than its last
 * start: the moment it came due (or the event arrived), what kept the run
 * from starting, the fix, and — under Technical details — the raw facts.
 * A standing state, not news: it is not announced on every visit.
 */
function SkipNotice({
  place,
  trigger,
  actions,
}: {
  place: TriggerPlace;
  trigger: TriggerView;
  actions: TriggerHealthActions;
}) {
  const { t } = useT('automations');
  const { formatDateSmart } = useFormatDate();
  const skippedAt = trigger.lastSkippedAt;
  const reason = trigger.lastSkipReason;
  if (skippedAt == null || reason == null) return null;
  if (skippedAt <= (trigger.lastFiredAt ?? 0)) return null;
  if (reason === 'paused_after_failures') return null;
  const detail: TriggerSkipDetail | null = trigger.lastSkipDetail ?? null;
  const kind = trigger.kind === 'event' ? 'event' : 'schedule';
  const at = (instant: number) => formatDateSmart(new Date(instant), 'long');
  const missedLine = (missed: MissedSummary | undefined) =>
    missed === undefined
      ? null
      : t('trigger.skip.alsoMissed', { count: missed.count });

  const actionButton = (label: string, onClick: () => void) => (
    <Button size="sm" variant="secondary" onClick={onClick}>
      {label}
    </Button>
  );

  let variant: 'info' | 'warning' | 'destructive' = 'info';
  let title: string;
  let body: ReactNode;
  let action: ReactNode = null;
  let technical: Array<[string, ReactNode]> = [];

  switch (reason) {
    case 'not_deployed': {
      const occurrence =
        detail?.reason === 'not_deployed' ? detail.occurrence : skippedAt;
      title = t('trigger.skip.notDeployed.title');
      body = joinLines(
        t('trigger.skip.notDeployed.body', { kind, at: at(occurrence) }),
        missedLine(
          detail?.reason === 'not_deployed' ? detail.missed : undefined,
        ),
      );
      action = (
        <TriggerEditorLink place={place}>
          {t('trigger.skip.openEditor')}
        </TriggerEditorLink>
      );
      break;
    }
    case 'start_refused': {
      variant = 'warning';
      const refused = detail?.reason === 'start_refused' ? detail : null;
      const occurrence = refused?.occurrence ?? skippedAt;
      const code = refused?.code ?? '';
      const also = missedLine(refused?.missed);
      const version = refused?.version ?? null;
      // The store names the version that refused an input; without it the
      // generic words below say what is known.
      if (code === 'AUTOMATION_INPUT_INVALID' && version !== null) {
        title = t('trigger.skip.inputRefused.title');
        body = joinLines(
          t('trigger.skip.inputRefused.body', {
            kind,
            at: at(occurrence),
            version,
          }),
          also,
        );
        action = (
          <span className="flex flex-wrap items-center gap-3">
            {actions.fillMissing !== undefined &&
              actionButton(
                t('trigger.fixedInput.fillMissing', {
                  count: actions.fillMissing.count,
                }),
                actions.fillMissing.run,
              )}
            <TriggerEditorLink place={place}>
              {t('trigger.skip.openEditor')}
            </TriggerEditorLink>
          </span>
        );
      } else if (PROJECT_CODES.has(code)) {
        title = t('trigger.skip.projectRefused.title');
        body = joinLines(
          t('trigger.skip.projectRefused.body', {
            kind,
            at: at(occurrence),
            reason: code === 'PROJECT_ARCHIVED' ? 'archived' : 'other',
          }),
          also,
        );
        action = actionButton(
          t('trigger.skip.editProjects'),
          actions.editProjects,
        );
      } else {
        title = t('trigger.skip.startRefused.title');
        body = joinLines(
          t('trigger.skip.startRefused.body', { kind, at: at(occurrence) }),
          also,
        );
        action = (
          <TriggerEditorLink place={place}>
            {t('trigger.skip.openEditor')}
          </TriggerEditorLink>
        );
      }
      technical = [
        ...(refused?.issues ?? []).map((issue): [string, ReactNode] => [
          issue.path || '$',
          issue.message,
        ]),
        ...(code === ''
          ? []
          : [
              ['code', <InlineCode key="code">{code}</InlineCode>] as [
                string,
                ReactNode,
              ],
            ]),
        ...(refused?.message
          ? [['message', refused.message] as [string, ReactNode]]
          : []),
      ];
      break;
    }
    case 'unusable_cron':
      variant = 'destructive';
      title = t('trigger.skip.unusableSchedule.title');
      body = t('trigger.skip.unusableSchedule.body', { at: at(skippedAt) });
      action = actionButton(
        t('trigger.skip.editSchedule'),
        actions.editSchedule,
      );
      technical =
        detail?.reason === 'unusable_cron' ? [['message', detail.message]] : [];
      break;
    case 'missed_occurrences': {
      if (detail?.reason !== 'missed_occurrences') return null;
      const { missed } = detail;
      title = missed.capped
        ? t('trigger.skip.missed.titleCapped', { count: missed.count })
        : t('trigger.skip.missed.title', { count: missed.count });
      body = t('trigger.skip.missed.body', {
        count: missed.count,
        from: at(missed.firstAt),
        to: at(missed.lastAt),
        policy:
          missed.policy === 'skip'
            ? t('trigger.skip.missed.policySkip')
            : t('trigger.skip.missed.policyLatest'),
      });
      break;
    }
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }

  return (
    <Alert
      variant={variant}
      // A standing state, not an event: announcing it on every visit to the
      // tab would repeat what the page already shows.
      live="off"
      title={title}
      className="animate-fade-in"
      description={
        <span className="flex flex-col gap-2">
          <span>{body}</span>
          {action !== null && <span>{action}</span>}
          <TechnicalDetails rows={technical} />
        </span>
      }
    />
  );
}

/** Two sentences as one paragraph, the second only when there is one. */
function joinLines(first: string, second: string | null): string {
  return second === null ? first : `${first} ${second}`;
}

/**
 * What the binding's failure streak says (`trigger-failures.ts`): a schedule
 * its failures paused — a standing banner until someone saves the trigger —
 * or runs failing in a row that will pause a schedule, each with the last
 * failure's code and a way into its run. Silent while the streak is empty.
 */
function TriggerFailureNotice({
  place,
  trigger,
}: {
  place: TriggerPlace;
  trigger: TriggerView;
}) {
  const { t } = useT('automations');
  const { formatDate } = useFormatDate();
  const count = trigger.consecutiveFailures ?? 0;
  const paused =
    !trigger.enabled && trigger.lastSkipReason === 'paused_after_failures';
  if (!paused && count === 0) return null;

  const lastFailure =
    trigger.lastFailedAt != null && trigger.lastFailureCode != null ? (
      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span>
          {t('trigger.failures.last', {
            at: formatDate(new Date(trigger.lastFailedAt), 'long'),
          })}
        </span>
        <InlineCode>{trigger.lastFailureCode}</InlineCode>
        {trigger.lastFailedRunId != null && (
          <TriggerRunLink place={place} runId={trigger.lastFailedRunId}>
            {t('trigger.failures.viewRun')}
          </TriggerRunLink>
        )}
      </span>
    ) : null;

  if (paused) {
    return (
      <Alert
        variant="warning"
        // A standing state, not an event: announcing it on every visit to
        // the tab would repeat what the page already shows.
        live="off"
        title={t('trigger.failures.pausedTitle')}
        description={
          <span className="flex flex-col gap-1">
            <span>{t('trigger.failures.pausedBody', { count })}</span>
            {lastFailure}
          </span>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      <Text as="p" variant="muted" className="text-xs">
        {t('trigger.failures.streak', { count })}
        {trigger.kind === 'schedule' &&
          trigger.enabled &&
          ` ${t('trigger.failures.streakSchedule', {
            limit: PERMANENT_FAILURES_BEFORE_PAUSE,
          })}`}
      </Text>
      {lastFailure !== null && (
        <Text as="div" variant="muted" className="text-xs">
          {lastFailure}
        </Text>
      )}
    </div>
  );
}
