'use client';

/**
 * What a project's dispatch does, as its readback says: whether it is on,
 * how many runs its pool holds, the models and agent workers it waits on,
 * every agent of its pool with what it works on or why it is idle, its
 * standing roles, its gates and its recent passes. Read only, but for the
 * gates, which project administrators hold and open from here.
 */

import {
  DISPATCH_DEFAULTS,
  type DispatchIdleReason,
  type ProjectDispatch,
  type ProjectDispatchStatus,
} from '@tale/shared/schemas/project-dispatch';
import { formatTaskIdentifier } from '@tale/shared/utils/project-key';
import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { DataTable } from '@tale/ui/data-table/data-table';
import { Row, Stack } from '@tale/ui/layout';
import { PageSection } from '@tale/ui/page-section';
import { StatGrid } from '@tale/ui/stat-grid';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { useNow } from '@tale/ui/use-now';
import { toast } from '@tale/ui/use-toast';
import { Link } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { Gauge } from 'lucide-react';
import { useCallback, useId, useMemo, useState } from 'react';

import { useAbility } from '@/app/hooks/use-ability';
import { failureDetail } from '@/app/lib/backend/adapters';
import { useT } from '@/lib/i18n/client';

import { useSetDispatchGate } from '../hooks/dispatch';

type PoolAgent = ProjectDispatchStatus['pool'][number];
type AgentRun = PoolAgent['runs'][number];
type AgentRunCounts = PoolAgent['runCounts'];
type StandingRoleRow = ProjectDispatchStatus['standingRoles'][number];
type GateRow = ProjectDispatchStatus['gates'][number];
type PassRow = ProjectDispatchStatus['passes'][number];

/** How often relative times on the page are read again. */
const CLOCK_MS = 30_000;

/** The runs an agent's row lists until the reader asks for the rest of
 * those the readback lists: a row stays a row while the agent holds
 * hundreds. */
const DISPATCH_RUNS_SHOWN = 5;

const IDLE_KEYS = {
  model_capacity: 'dispatch.idle.model_capacity',
  host_pressure: 'dispatch.idle.host_pressure',
  org_limit: 'dispatch.idle.org_limit',
  pacing: 'dispatch.idle.pacing',
  gated: 'dispatch.idle.gated',
  no_ready_work: 'dispatch.idle.no_ready_work',
  disabled: 'dispatch.idle.disabled',
  unknown: 'dispatch.idle.unknown',
} as const satisfies Record<DispatchIdleReason, string>;

const STOP_KEYS = {
  disabled: 'dispatch.passes.stop.disabled',
  automation_disabled: 'dispatch.passes.stop.automation_disabled',
  pool_full: 'dispatch.passes.stop.pool_full',
  org_limit: 'dispatch.passes.stop.org_limit',
  no_ready_work: 'dispatch.passes.stop.no_ready_work',
  agents_busy: 'dispatch.passes.stop.agents_busy',
  model_capacity: 'dispatch.passes.stop.model_capacity',
  host_pressure: 'dispatch.passes.stop.host_pressure',
  pacing: 'dispatch.passes.stop.pacing',
  gated: 'dispatch.passes.stop.gated',
  started: 'dispatch.passes.stop.started',
  held: 'dispatch.passes.stop.held',
} as const;

const TRIGGER_KEYS = {
  scan: 'dispatch.passes.trigger.scan',
  run_ended: 'dispatch.passes.trigger.run_ended',
  capacity_cleared: 'dispatch.passes.trigger.capacity_cleared',
  config: 'dispatch.passes.trigger.config',
  recheck: 'dispatch.passes.trigger.recheck',
  manual: 'dispatch.passes.trigger.manual',
  gate: 'dispatch.passes.trigger.gate',
} as const;

const OUTCOME_KEYS = {
  started: 'dispatch.roles.outcome.started',
  coalesced: 'dispatch.roles.outcome.coalesced',
  refused: 'dispatch.roles.outcome.refused',
} as const;

const REFUSAL_KEYS = {
  paused: 'dispatch.roles.refusal.paused',
  blocked: 'dispatch.roles.refusal.blocked',
  in_review: 'dispatch.roles.refusal.in_review',
  closed: 'dispatch.roles.refusal.closed',
} as const;

/** Why a run waits, worded as the task's own run row words it. */
const WAITING_KEYS = {
  org_limit: 'agentRun.waiting.org_limit',
  host: 'agentRun.waiting.host',
  destroy_pending: 'agentRun.waiting.destroy_pending',
  exec_limit: 'agentRun.waiting.exec_limit',
  model_capacity: 'agentRun.waiting.model_capacity',
  unknown: 'agentRun.waiting.unknown',
} as const;

/** The key a code names in one of the tables above, or none for a code this
 * build does not know (a newer server's): the page then shows the code. */
function keyOf(
  table: Readonly<Record<string, string>>,
  code: string | null,
): string | undefined {
  if (code === null || !Object.hasOwn(table, code)) return undefined;
  return table[code];
}

const LINK_CLASS =
  'text-foreground focus-visible:ring-ring rounded-sm underline-offset-2 hover:underline focus-visible:ring-1 focus-visible:outline-none';

/** A moment as "3 minutes ago" / "in 40 seconds", with the full date and
 * time as its machine-readable value and tooltip. */
function RelativeTime({ value }: { value: number }) {
  const { formatRelative, formatDate } = useFormatDate();
  const date = new Date(value);
  return (
    <time dateTime={date.toISOString()} title={formatDate(date, 'long')}>
      {formatRelative(date)}
    </time>
  );
}

function TaskLink({
  organizationId,
  taskId,
  label,
}: {
  organizationId: string;
  taskId: string;
  label: string;
}) {
  return (
    <Link
      to="/dashboard/$id/tasks/$taskId"
      params={{ id: organizationId, taskId }}
      className={`${LINK_CLASS} block truncate`}
      title={label}
    >
      {label}
    </Link>
  );
}

/** How many runs an agent holds, by what they do: working, queued, and
 * waiting, by why — worded as the task's own run row words it. */
function PoolAgentRunCounts({ counts }: { counts: AgentRunCounts }) {
  const { t } = useT('projects');
  const { t: tTasks } = useT('tasks');
  const parts = [
    ...(counts.running > 0
      ? [
          {
            key: 'running',
            label: t('dispatch.agents.running'),
            count: counts.running,
          },
        ]
      : []),
    ...(counts.queued > 0
      ? [
          {
            key: 'queued',
            label: t('dispatch.agents.queued'),
            count: counts.queued,
          },
        ]
      : []),
    ...Object.entries(counts.waiting)
      .filter(([, count]) => count > 0)
      .map(([reason, count]) => {
        const waiting = keyOf(WAITING_KEYS, reason);
        return {
          key: `waiting:${reason}`,
          label: waiting === undefined ? reason : tTasks(waiting),
          count,
        };
      }),
  ];
  return (
    <Row as="ul" gap={2} wrap className="text-muted-foreground text-xs">
      {parts.map((part) => (
        <li key={part.key}>
          {t('dispatch.agents.runCount', {
            label: part.label,
            count: part.count,
          })}
        </li>
      ))}
    </Row>
  );
}

/** The runs an agent of the pool holds: each task, and whether its run
 * works or waits — and why, worded as the task's own run row words it. An
 * agent kept on many tasks shows how many it holds, by what they do, and
 * its first runs, with the rest the readback lists a click away. */
function PoolAgentRuns({
  organizationId,
  projectKey,
  runs,
  counts,
}: {
  organizationId: string;
  projectKey: string | undefined;
  runs: AgentRun[];
  counts: AgentRunCounts;
}) {
  const { t } = useT('projects');
  const { t: tTasks } = useT('tasks');
  const listId = useId();
  const [expanded, setExpanded] = useState(false);
  if (counts.total === 0 && runs.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  const shown = expanded ? runs : runs.slice(0, DISPATCH_RUNS_SHOWN);
  const hidden = runs.length - shown.length;
  const unlisted = Math.max(0, counts.total - runs.length);
  return (
    <Stack gap={1} className="min-w-0 items-start">
      {counts.total > DISPATCH_RUNS_SHOWN ? (
        <PoolAgentRunCounts counts={counts} />
      ) : null}
      <Stack as="ul" id={listId} gap={1} className="w-full min-w-0">
        {shown.map((run) => {
          const identifier = formatTaskIdentifier(projectKey, run.taskNumber);
          const waiting = keyOf(WAITING_KEYS, run.waitingReason);
          return (
            <li key={run.runId} className="min-w-0">
              <TaskLink
                organizationId={organizationId}
                taskId={run.taskId}
                label={
                  identifier === null
                    ? run.taskTitle
                    : `${identifier} ${run.taskTitle}`
                }
              />
              <span className="text-muted-foreground text-xs">
                {run.status === 'running'
                  ? t('dispatch.agents.running')
                  : waiting === undefined
                    ? t('dispatch.agents.queued')
                    : tTasks(waiting)}
              </span>
            </li>
          );
        })}
      </Stack>
      {runs.length > DISPATCH_RUNS_SHOWN ? (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-6 px-0 text-xs"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded
            ? t('dispatch.agents.showFewer')
            : t('dispatch.agents.showMore', { count: hidden })}
        </Button>
      ) : null}
      {unlisted > 0 && (expanded || runs.length <= DISPATCH_RUNS_SHOWN) ? (
        <span className="text-muted-foreground text-xs">
          {t('dispatch.agents.notListed', { count: unlisted })}
        </span>
      ) : null}
    </Stack>
  );
}

interface ProjectDispatchOverviewProps {
  organizationId: string;
  projectId: string;
  status: ProjectDispatchStatus;
  config: ProjectDispatch;
  /** The reader may hold and open the gates. */
  canEdit: boolean;
  projectKey: string | undefined;
  /** Names of the project's agents, for the standing roles. */
  agentNames: ReadonlyMap<string, string>;
}

export function ProjectDispatchOverview({
  organizationId,
  projectId,
  status,
  config,
  canEdit,
  projectKey,
  agentNames,
}: ProjectDispatchOverviewProps) {
  const { t } = useT('projects');
  const { formatDateSmart } = useFormatDate();
  const ability = useAbility();
  // Relative times ("3 minutes ago") move on while the page is open.
  const now = useNow(CLOCK_MS);

  const running = status.pool.reduce(
    (sum, agent) => sum + agent.runCounts.total,
    0,
  );
  const perAgent =
    config.perAgentConcurrency ?? DISPATCH_DEFAULTS.perAgentConcurrency;
  const lastStopKey = keyOf(STOP_KEYS, status.state?.lastStopReason ?? null);
  const nextPassAt = status.state?.nextPassAt ?? null;

  const summary = [
    {
      label: t('dispatch.summary.status'),
      value: (
        <Badge variant={config.enabled ? 'green' : 'slate'} dot>
          {t(config.enabled ? 'dispatch.summary.on' : 'dispatch.summary.off')}
        </Badge>
      ),
    },
    {
      label: t('dispatch.summary.runs'),
      value: t('dispatch.summary.runsValue', {
        running,
        max: config.maxConcurrentRuns,
      }),
    },
    {
      label: t('dispatch.summary.workers'),
      value: t('dispatch.summary.workersValue', {
        inUse: status.workers.inUse,
        limit: status.workers.limit,
      }),
    },
    {
      label: t('dispatch.summary.lastPass'),
      value:
        status.state?.lastPassAt == null ? (
          t('dispatch.summary.noPass')
        ) : (
          <Stack gap={0}>
            <RelativeTime value={status.state.lastPassAt} />
            {status.state.lastStopReason !== null ? (
              <Text variant="caption" className="text-muted-foreground">
                {lastStopKey === undefined
                  ? status.state.lastStopReason
                  : t(lastStopKey)}
              </Text>
            ) : null}
          </Stack>
        ),
    },
    {
      label: t('dispatch.summary.nextPass'),
      value: !config.enabled ? (
        '—'
      ) : nextPassAt !== null && nextPassAt > now ? (
        <RelativeTime value={nextPassAt} />
      ) : (
        t('dispatch.summary.nextPassSoon')
      ),
    },
  ];

  const agentColumns = useMemo<ColumnDef<PoolAgent>[]>(
    () => [
      {
        id: 'agent',
        header: t('dispatch.agents.agent'),
        size: 160,
        cell: ({ row }) => (
          <span className="font-medium">{row.original.name}</span>
        ),
      },
      {
        id: 'model',
        header: t('dispatch.agents.model'),
        size: 150,
        meta: { skeleton: { type: 'two-line' } },
        cell: ({ row }) => (
          <Stack gap={0} className="min-w-0">
            <span className="truncate text-sm">{row.original.model}</span>
            {row.original.modelProvider !== null ? (
              <span className="text-muted-foreground truncate text-xs">
                {row.original.modelProvider}
              </span>
            ) : null}
          </Stack>
        ),
      },
      {
        id: 'workingOn',
        header: t('dispatch.agents.workingOn'),
        size: 220,
        cell: ({ row }) => (
          <PoolAgentRuns
            organizationId={organizationId}
            projectKey={projectKey}
            runs={row.original.runs}
            counts={row.original.runCounts}
          />
        ),
      },
      {
        id: 'idle',
        header: t('dispatch.agents.idleBecause'),
        size: 180,
        cell: ({ row }) => {
          const reason = row.original.idle;
          return reason === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span>{t(IDLE_KEYS[reason])}</span>
          );
        },
      },
    ],
    [t, organizationId, projectKey],
  );

  const roleColumns = useMemo<ColumnDef<StandingRoleRow>[]>(
    () => [
      {
        id: 'role',
        header: t('dispatch.roles.role'),
        size: 120,
        cell: ({ row }) => (
          <Stack gap={1} className="items-start">
            <span className="font-mono text-xs">{row.original.key}</span>
            {row.original.mode !== null ? (
              <Badge variant="outline">{row.original.mode}</Badge>
            ) : null}
          </Stack>
        ),
      },
      {
        id: 'agent',
        header: t('dispatch.roles.agent'),
        size: 140,
        cell: ({ row }) =>
          agentNames.get(row.original.agentId) ?? (
            <span className="text-muted-foreground">
              {t('dispatch.roles.unknownAgent')}
            </span>
          ),
      },
      {
        id: 'task',
        header: t('dispatch.roles.task'),
        size: 180,
        cell: ({ row }) =>
          row.original.taskTitle === null ? (
            <span className="text-muted-foreground">
              {t('dispatch.roles.unknownTask')}
            </span>
          ) : (
            <TaskLink
              organizationId={organizationId}
              taskId={row.original.taskId}
              label={row.original.taskTitle}
            />
          ),
      },
      {
        id: 'schedule',
        header: t('dispatch.roles.schedule'),
        size: 140,
        meta: { skeleton: { type: 'two-line' } },
        cell: ({ row }) => (
          <Stack gap={0}>
            <span className="font-mono text-xs">{row.original.cron}</span>
            <span className="text-muted-foreground text-xs">
              {row.original.timezone}
            </span>
          </Stack>
        ),
      },
      {
        id: 'next',
        header: t('dispatch.roles.next'),
        size: 120,
        cell: ({ row }) =>
          row.original.nextAt === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <time dateTime={new Date(row.original.nextAt).toISOString()}>
              {formatDateSmart(new Date(row.original.nextAt), 'long')}
            </time>
          ),
      },
      {
        id: 'last',
        header: t('dispatch.roles.last'),
        size: 180,
        meta: { skeleton: { type: 'two-line' } },
        cell: ({ row }) => {
          const last = row.original.last;
          if (last === null) {
            return (
              <span className="text-muted-foreground">
                {t('dispatch.roles.notYet')}
              </span>
            );
          }
          const refusal =
            last.outcome === 'refused'
              ? keyOf(REFUSAL_KEYS, last.reason)
              : undefined;
          const outcome = keyOf(OUTCOME_KEYS, last.outcome);
          return (
            <Stack gap={0}>
              <span>
                {refusal !== undefined
                  ? t(refusal)
                  : outcome !== undefined
                    ? t(outcome)
                    : last.outcome}
              </span>
              <time
                dateTime={new Date(last.at).toISOString()}
                className="text-muted-foreground text-xs"
              >
                {formatDateSmart(new Date(last.at), 'long')}
              </time>
            </Stack>
          );
        },
      },
    ],
    [t, agentNames, organizationId, formatDateSmart],
  );

  const passColumns = useMemo<ColumnDef<PassRow>[]>(
    () => [
      {
        id: 'when',
        header: t('dispatch.passes.when'),
        size: 130,
        cell: ({ row }) => <RelativeTime value={row.original.startedAt} />,
      },
      {
        id: 'askedBy',
        header: t('dispatch.passes.askedBy'),
        size: 170,
        cell: ({ row }) => {
          const key = keyOf(TRIGGER_KEYS, row.original.trigger);
          return key === undefined ? row.original.trigger : t(key);
        },
      },
      {
        id: 'started',
        header: t('dispatch.passes.started'),
        size: 80,
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.started}</span>
        ),
      },
      {
        id: 'held',
        header: t('dispatch.passes.held'),
        size: 80,
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.held}</span>
        ),
      },
      {
        id: 'stoppedBecause',
        header: t('dispatch.passes.stoppedBecause'),
        size: 190,
        cell: ({ row }) => {
          const key = keyOf(STOP_KEYS, row.original.stopReason);
          return key === undefined ? row.original.stopReason : t(key);
        },
      },
    ],
    [t],
  );

  return (
    <Stack gap={8}>
      <StatGrid items={summary} cols={2} className="md:grid-cols-5" />

      {status.poolExceedsWorkers ? (
        <Alert
          variant="warning"
          live="off"
          title={t('dispatch.workersWarning.title')}
          description={
            <p>
              {t('dispatch.workersWarning.body', {
                runs: Math.min(
                  config.maxConcurrentRuns,
                  config.agents.length * perAgent,
                ),
                workers: status.workers.limit,
              })}
              {ability.can('write', 'orgSettings') ? (
                <>
                  {' '}
                  <Link
                    to="/dashboard/$id/settings/sandboxes"
                    params={{ id: organizationId }}
                    className={`${LINK_CLASS} font-medium underline`}
                  >
                    {t('dispatch.workersWarning.manage')}
                  </Link>
                </>
              ) : null}
            </p>
          }
        />
      ) : null}

      {status.holds.length > 0 ? (
        <Alert
          variant="info"
          icon={Gauge}
          live="off"
          title={t('dispatch.holds.title', { count: status.holds.length })}
          description={
            <Stack gap={1}>
              <p>{t('dispatch.holds.body')}</p>
              <ul className="list-disc pl-5">
                {status.holds.map((hold) => (
                  <li key={`${hold.modelProvider}/${hold.model}`}>
                    {t('dispatch.holds.item', {
                      model:
                        hold.modelProvider === ''
                          ? hold.model
                          : `${hold.model} (${hold.modelProvider})`,
                      time: formatDateSmart(new Date(hold.heldUntil), 'long'),
                    })}
                  </li>
                ))}
              </ul>
            </Stack>
          }
        />
      ) : null}

      <PageSection title={t('dispatch.agents.title')}>
        <DataTable<PoolAgent>
          columns={agentColumns}
          data={status.pool}
          getRowId={(row) => row.agentId}
          caption={t('dispatch.agents.caption')}
          emptyState={{
            title: t(
              canEdit ? 'dispatch.agents.emptyEditor' : 'dispatch.agents.empty',
            ),
          }}
        />
      </PageSection>

      {status.standingRoles.length > 0 ? (
        <PageSection title={t('dispatch.roles.title')}>
          <DataTable<StandingRoleRow>
            columns={roleColumns}
            data={status.standingRoles}
            getRowId={(row) => row.key}
            caption={t('dispatch.roles.caption')}
          />
        </PageSection>
      ) : null}

      {status.gates.length > 0 ? (
        <DispatchGates
          organizationId={organizationId}
          projectId={projectId}
          gates={status.gates}
          canEdit={canEdit}
          now={now}
        />
      ) : null}

      <PageSection title={t('dispatch.passes.title')}>
        <DataTable<PassRow>
          columns={passColumns}
          data={status.passes}
          getRowId={(row) => row.id}
          caption={t('dispatch.passes.caption')}
          emptyState={{ title: t('dispatch.passes.empty') }}
        />
      </PageSection>
    </Stack>
  );
}

/** The dispatch's gates, with Hold and Open for who may administer the
 * project. Each change is reported once: its own toast, success or not. */
function DispatchGates({
  organizationId,
  projectId,
  gates,
  canEdit,
  now,
}: {
  organizationId: string;
  projectId: string;
  gates: GateRow[];
  canEdit: boolean;
  now: number;
}) {
  const { t } = useT('projects');
  const { formatDateSmart } = useFormatDate();
  const { mutateAsync: setGate } = useSetDispatchGate(
    organizationId,
    projectId,
  );
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const change = useCallback(
    (key: string, state: 'hold' | 'open') => {
      setPendingKey(key);
      setGate({ key, state })
        .then(
          () => {
            toast({
              title: t(
                state === 'hold'
                  ? 'dispatch.gates.heldToast'
                  : 'dispatch.gates.openedToast',
                { key },
              ),
              variant: 'success',
            });
          },
          (error: unknown) => {
            console.error('[dispatch] gate change failed', error);
            toast({
              title: t('dispatch.gates.changeFailed'),
              description: failureDetail(error),
              variant: 'destructive',
            });
          },
        )
        .finally(() => setPendingKey(null));
    },
    [setGate, t],
  );

  const columns = useMemo<ColumnDef<GateRow>[]>(
    () => [
      {
        id: 'gate',
        header: t('dispatch.gates.gate'),
        size: 110,
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.key}</span>
        ),
      },
      {
        id: 'holds',
        header: t('dispatch.gates.holds'),
        size: 150,
        cell: ({ row }) =>
          row.original.labels === null ? (
            <span className="text-muted-foreground">
              {t('dispatch.gates.allWork')}
            </span>
          ) : (
            <Row gap={1} wrap>
              {row.original.labels.map((label) => (
                <Badge key={label} variant="outline">
                  {label}
                </Badge>
              ))}
            </Row>
          ),
      },
      {
        id: 'state',
        header: t('dispatch.gates.state'),
        size: 190,
        meta: { skeleton: { type: 'badge-text', lineGap: 1 } },
        cell: ({ row }) => {
          const gate = row.original;
          return (
            <Stack gap={1} className="items-start">
              <Row gap={1} wrap>
                <Badge variant={gate.held ? 'orange' : 'green'} dot>
                  {t(
                    gate.held
                      ? 'dispatch.gates.states.held'
                      : 'dispatch.gates.states.open',
                  )}
                </Badge>
                {gate.stale ? (
                  <Badge variant="outline">
                    {t('dispatch.gates.states.stale')}
                  </Badge>
                ) : null}
              </Row>
              {gate.value !== null ? (
                <span className="text-muted-foreground text-xs">
                  {gate.holdAt === null
                    ? t('dispatch.gates.valueOnly', { value: gate.value })
                    : t('dispatch.gates.value', {
                        value: gate.value,
                        holdAt: gate.holdAt,
                      })}
                </span>
              ) : null}
              {gate.spacedUntil !== null && gate.spacedUntil > now ? (
                <span className="text-muted-foreground text-xs">
                  {t('dispatch.gates.spacedUntil', {
                    time: formatDateSmart(new Date(gate.spacedUntil), 'long'),
                  })}
                </span>
              ) : null}
            </Stack>
          );
        },
      },
      {
        id: 'lastReport',
        header: t('dispatch.gates.lastReport'),
        size: 170,
        meta: { skeleton: { type: 'two-line' } },
        cell: ({ row }) =>
          row.original.reportedAt === null ? (
            <span className="text-muted-foreground">
              {t('dispatch.gates.noReport')}
            </span>
          ) : (
            <Stack gap={0}>
              <RelativeTime value={row.original.reportedAt} />
              {row.original.reason !== null ? (
                <span className="text-muted-foreground text-xs break-words">
                  {row.original.reason}
                </span>
              ) : null}
            </Stack>
          ),
      },
      ...(canEdit
        ? [
            {
              id: 'actions',
              meta: { isAction: true },
              // Empty like every entity table's row-action column: the
              // DataTable supplies the screen-reader label.
              header: '',
              size: 150,
              cell: ({ row }) => {
                const busy = pendingKey === row.original.key;
                return (
                  <Row gap={1} className="justify-end">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      aria-label={t('dispatch.gates.holdAria', {
                        key: row.original.key,
                      })}
                      onClick={() => change(row.original.key, 'hold')}
                    >
                      {t('dispatch.gates.hold')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      aria-label={t('dispatch.gates.openAria', {
                        key: row.original.key,
                      })}
                      onClick={() => change(row.original.key, 'open')}
                    >
                      {t('dispatch.gates.open')}
                    </Button>
                  </Row>
                );
              },
            } satisfies ColumnDef<GateRow>,
          ]
        : []),
    ],
    [t, canEdit, pendingKey, now, change, formatDateSmart],
  );

  return (
    <PageSection title={t('dispatch.gates.title')}>
      <DataTable<GateRow>
        columns={columns}
        data={gates}
        getRowId={(row) => row.key}
        caption={t('dispatch.gates.caption')}
      />
    </PageSection>
  );
}
