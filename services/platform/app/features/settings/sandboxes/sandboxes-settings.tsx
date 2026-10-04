import { Badge } from '@tale/ui/badge';
import { DataTable } from '@tale/ui/data-table/data-table';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { EntityRowActions } from '@tale/ui/entity/entity-row-actions';
import { Row, Stack } from '@tale/ui/layout';
import { TableDateCell } from '@tale/ui/table-date-cell';
import { useFormatDate } from '@tale/ui/use-format-date';
import { useToast } from '@tale/ui/use-toast';
import type { ColumnDef } from '@tanstack/react-table';
import { Box, Pin, PinOff, Square, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useBackendAction } from '@/app/hooks/use-backend-action';
import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { failureDetail } from '@/app/lib/backend/adapters';
import type { ReturnsOf } from '@/app/lib/backend/contract';
import { useT } from '@/lib/i18n/client';
import type { SandboxDeviceView } from '@/lib/shared/schemas/sandbox-devices';

import { SandboxCapacitySection } from './sandbox-capacity';
import { SandboxDevicesSection } from './sandbox-devices';
import { SandboxQuotaEditor } from './sandbox-quota-editor';
import { sandboxRuntimeState } from './sandbox-runtime-state';
import { WorkspaceCleanupEditor } from './workspace-cleanup-editor';

type SandboxList = NonNullable<
  ReturnsOf<'sandbox/session_queries_public:listSandboxesForOrg'>
>;
type SandboxRow = SandboxList[number];

interface SandboxesSettingsProps {
  organizationId: string;
}

function formatCents(cents: number | undefined): string {
  if (cents === undefined) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}

export function SandboxesSettings({ organizationId }: SandboxesSettingsProps) {
  const { t } = useT('sandboxes');
  const { toast } = useToast();
  const ability = useAbility();
  const abilityLoading = useAbilityLoading();
  const canRead = ability.can('read', 'developerSettings');
  const canManage = ability.can('write', 'orgSettings');

  const { data, isLoading, error } = useBackendQuery(
    'sandbox/session_queries_public:listSandboxesForOrg',
    canManage ? { organizationId } : 'skip',
  );

  const capacity = useBackendQuery(
    'sandbox/session_queries_public:getSandboxCapacity',
    canRead ? { organizationId } : 'skip',
  );
  const snapshot = capacity.isError ? undefined : capacity.data;
  const deploymentLimits = useBackendQuery(
    'sandbox/session_queries_public:getSandboxDeploymentLimits',
    canRead ? { organizationId } : 'skip',
  );
  // While the caller's role is still loading the query is skipped (not
  // loading, no data) — the editor must read that as "still checking", not
  // as an unavailable capacity it would alert about for a moment.
  const deploymentLimitsLoading = abilityLoading || deploymentLimits.isLoading;
  const refreshDeploymentLimits = useCallback(() => {
    void deploymentLimits.refetch();
  }, [deploymentLimits]);
  const refreshCapacity = useCallback(() => {
    void capacity.refetch();
    void deploymentLimits.refetch();
  }, [capacity, deploymentLimits]);
  // Connected devices: listed for admins and developers, and named on the
  // workspaces that run on them.
  const devicesQuery = useBackendQuery(
    'sandbox_devices/queries:list',
    canRead ? { organizationId } : 'skip',
  );
  const devicesView = devicesQuery.isError ? undefined : devicesQuery.data;
  const refetchDevices = devicesQuery.refetch;
  const refreshDevices = useCallback(() => {
    void refetchDevices();
  }, [refetchDevices]);

  // Each control runs through `run` below, whose failure toast says why:
  // the three writes keep their default toast quiet.
  const stop = useBackendAction(
    'node_only/sandbox/session_admin_actions:stopSandboxTask',
    { errorToast: false },
  );
  const destroy = useBackendAction(
    'node_only/sandbox/session_admin_actions:destroySandbox',
    { errorToast: false },
  );
  const setPinned = useBackendAction(
    'node_only/sandbox/session_admin_actions:setSandboxPinned',
    { errorToast: false },
  );

  // Reconcile business allocation records on mount. Physical runtime state
  // comes from the separate infrastructure snapshot below.
  const reconcile = useBackendAction(
    'node_only/sandbox/session_admin_actions:reconcileOrgSessions',
  );
  const reconcileMutate = reconcile.mutate;
  useEffect(() => {
    if (canManage) reconcileMutate({ organizationId });
  }, [organizationId, reconcileMutate, canManage]);

  // The session id whose control is mid-flight (disables that row's buttons).
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmDestroy, setConfirmDestroy] = useState<string | null>(null);

  const run = useCallback(
    async (
      sessionId: string,
      fn: () => Promise<unknown>,
      successKey: string,
      successDescriptionKey?: string,
    ): Promise<void> => {
      setPendingId(sessionId);
      try {
        await fn();
        toast({
          title: t(successKey),
          ...(successDescriptionKey !== undefined
            ? { description: t(successDescriptionKey) }
            : {}),
        });
      } catch (err) {
        toast({
          title: t('toast.error'),
          description: failureDetail(err),
          variant: 'destructive',
        });
      } finally {
        setPendingId(null);
      }
    },
    [t, toast],
  );

  // Column sizes fit each header label in every shipped locale (the widest:
  // fr "Espace de travail", de "Aktuelle Aufgaben") and sum to the settings
  // pane's width, so the table neither clips a header nor scrolls sideways.
  const columns = useMemo<ColumnDef<SandboxRow>[]>(
    () => [
      {
        accessorKey: 'createdBy',
        header: t('columns.owner'),
        size: 150,
        meta: { skeleton: { type: 'two-line' } },
        cell: ({ row }) => {
          const s = row.original;
          // A deleted agent's workspace stays listed until the cleanup has
          // deleted it (work still running in it, or a legal hold, keeps it
          // longer): once the owner join answers nothing, say whose it was
          // rather than print the id nobody can look up any more.
          const ownerLabel =
            s.ownerType === 'project_agent' && s.ownerLabel == null
              ? t('deletedAgent')
              : (s.ownerLabel ?? s.ownerName ?? s.ownerEmail ?? s.ownerId);
          // A long owner name or fallback identifier stays within this column.
          return (
            <Stack gap={0} className="max-w-[220px] min-w-0">
              <span className="truncate font-medium">{ownerLabel}</span>
              {s.ownerEmail && !s.ownerLabel && s.ownerName && (
                <span className="text-muted-foreground truncate text-xs">
                  {s.ownerEmail}
                </span>
              )}
            </Stack>
          );
        },
      },
      {
        accessorKey: 'agentKind',
        header: t('columns.agent'),
        size: 90,
        // A harness id (`claude-code`), so it reads like the run ids below.
        cell: ({ row }) =>
          row.original.agentKind === null ? (
            '—'
          ) : (
            <span className="font-mono text-xs">{row.original.agentKind}</span>
          ),
      },
      {
        id: 'status',
        size: 150,
        header: t('columns.status'),
        meta: { skeleton: { type: 'badge-text', lineGap: 1 } },
        cell: ({ row }) => {
          const s = row.original;
          const paused = s.currentOp?.pausedReason === 'budget';
          const runtime = sandboxRuntimeState(snapshot, s.sessionId);
          const allocated = s.status === 'creating' || s.status === 'active';
          return (
            <Stack gap={1}>
              <Row gap={1} align="stretch" wrap>
                <Badge
                  variant={
                    runtime === 'running'
                      ? 'green'
                      : runtime === 'starting'
                        ? 'yellow'
                        : 'outline'
                  }
                >
                  {t(`status.runtime.${runtime}`)}
                </Badge>
                {paused && (
                  <Badge variant="destructive">
                    {t('status.pausedBudget')}
                  </Badge>
                )}
                {s.pinned && <Badge variant="blue">{t('status.pinned')}</Badge>}
                {s.destroyState === 'pending' && (
                  <Badge variant="yellow">{t('status.destroying')}</Badge>
                )}
                {s.destroyState === 'failed' && (
                  <Badge variant="destructive">
                    {t('status.destroyFailed')}
                  </Badge>
                )}
              </Row>
              <span className="text-muted-foreground text-xs">
                {t(allocated ? 'status.quotaInUse' : 'status.quotaReleased')}
              </span>
              <RunsOn
                sessionId={s.sessionId}
                placements={
                  snapshot?.status === 'available'
                    ? snapshot.placements
                    : undefined
                }
                devices={devicesView?.devices}
              />
              <DeletesOn deletesAt={s.deletesAt} />
            </Stack>
          );
        },
      },
      {
        id: 'task',
        size: 150,
        header: t('columns.task'),
        // Every turn executing in this workspace: a project agent runs its
        // tasks concurrently in the one workspace it owns, so a single
        // "current" op would hide its siblings.
        cell: ({ row }) => {
          const ops = row.original.runningOps;
          const lead = ops[0];
          if (lead === undefined) {
            return (
              <span className="text-muted-foreground">{t('task.none')}</span>
            );
          }
          return (
            <Stack gap={0}>
              <span className="text-xs">
                {t(
                  lead.kind === 'workflow-agent'
                    ? 'task.workflow'
                    : lead.kind === 'task-agent'
                      ? 'task.project'
                      : 'task.active',
                  { count: ops.length },
                )}
              </span>
              {ops.map((op) => {
                const runId = op.taskId ?? op.workflowRunId;
                return runId === undefined ? null : (
                  <span
                    key={op.execId}
                    className="text-muted-foreground font-mono text-xs"
                  >
                    {runId.slice(0, 8)}
                  </span>
                );
              })}
            </Stack>
          );
        },
      },
      {
        id: 'spend',
        size: 80,
        header: t('columns.spend'),
        // Cumulative spend across every task this sandbox has run. `|| undefined`
        // renders a never-billed sandbox as "—" rather than a misleading $0.00.
        cell: ({ row }) =>
          formatCents(row.original.totalSpentCents || undefined),
      },
      {
        accessorKey: 'createdAt',
        header: t('columns.created'),
        size: 100,
        cell: ({ row }) => <TableDateCell date={row.original.createdAt} />,
      },
      {
        id: 'actions',
        size: 44,
        meta: { isAction: true },
        // Empty like every entity table's row-action column: the DataTable
        // supplies the screen-reader label, and a visible word does not fit
        // the pinned trigger box.
        header: '',
        cell: ({ row }) => {
          const s = row.original;
          const busy = pendingId === s.sessionId;
          // A queued Destroy unpins and deletes the workspace whatever is
          // asked of it meanwhile, so Pin and Destroy wait until it is gone.
          // Stop stays: a task that runs while the Destroy retries can still
          // be stopped.
          const changing = busy || s.destroyState === 'pending';
          return (
            <Row gap={0} align="stretch" justify="end">
              <EntityRowActions
                actions={[
                  {
                    key: 'stop',
                    label: t('actions.stop'),
                    icon: Square,
                    // Stop only applies to a sandbox running a task.
                    visible: s.busy,
                    disabled: busy,
                    onClick: () =>
                      void run(
                        s.sessionId,
                        () =>
                          stop.mutateAsync({
                            organizationId,
                            sessionId: s.sessionId,
                          }),
                        'toast.stopped',
                      ),
                  },
                  {
                    key: 'pin',
                    label: s.pinned ? t('actions.unpin') : t('actions.pin'),
                    icon: s.pinned ? PinOff : Pin,
                    disabled: changing,
                    onClick: () =>
                      void run(
                        s.sessionId,
                        () =>
                          setPinned.mutateAsync({
                            organizationId,
                            sessionId: s.sessionId,
                            pinned: !s.pinned,
                          }),
                        s.pinned ? 'toast.unpinned' : 'toast.pinned',
                      ),
                  },
                  {
                    key: 'destroy',
                    label: t('actions.destroy'),
                    icon: Trash2,
                    // Auto-gets a separator above it; the confirm dialog below
                    // gates the actual teardown.
                    destructive: true,
                    disabled: changing,
                    onClick: () => setConfirmDestroy(s.sessionId),
                  },
                ]}
              />
            </Row>
          );
        },
      },
    ],
    [t, organizationId, pendingId, stop, setPinned, run, snapshot, devicesView],
  );

  if ((canManage && data === null) || (!abilityLoading && !canRead)) {
    return <AccessDenied message={t('accessDenied')} />;
  }

  return (
    <>
      <SandboxQuotaEditor
        organizationId={organizationId}
        deploymentLimits={
          deploymentLimits.isError ? undefined : deploymentLimits.data
        }
        deploymentLimitsLoading={deploymentLimitsLoading}
        onRefreshDeploymentLimits={refreshDeploymentLimits}
      />
      <SandboxCapacitySection
        capacity={snapshot}
        isLoading={capacity.isLoading}
        isRefreshing={capacity.isFetching || deploymentLimits.isFetching}
        onRefresh={refreshCapacity}
      />
      {canRead && (
        <SandboxDevicesSection
          organizationId={organizationId}
          view={devicesView}
          isLoading={abilityLoading || devicesQuery.isLoading}
          error={devicesQuery.error ?? null}
          canManage={canManage}
          onRefresh={refreshDevices}
        />
      )}
      {canManage && <WorkspaceCleanupEditor organizationId={organizationId} />}
      {canManage && (
        <SettingsSection
          title={t('sessionsTitle')}
          description={t('description')}
        >
          <DataTable<SandboxRow>
            columns={columns}
            data={data ?? []}
            isLoading={isLoading}
            error={error}
            approxRowCount={data?.length}
            getRowId={(row) => row.sessionId}
            emptyState={{
              icon: Box,
              title: t('empty.title'),
              description: t('empty.description'),
            }}
            caption={t('title')}
          />
          <ConfirmDialog
            open={canManage && confirmDestroy !== null}
            onOpenChange={(open) => !open && setConfirmDestroy(null)}
            title={t('destroyConfirm.title')}
            description={t('destroyConfirm.description')}
            confirmText={t('destroyConfirm.confirm')}
            variant="destructive"
            isLoading={pendingId !== null && pendingId === confirmDestroy}
            onConfirm={() => {
              const sessionId = confirmDestroy;
              if (!sessionId) return;
              void run(
                sessionId,
                () => destroy.mutateAsync({ organizationId, sessionId }),
                'toast.destroying',
                'toast.destroyingDescription',
              ).finally(() => setConfirmDestroy(null));
            }}
          />
        </SettingsSection>
      )}
    </>
  );
}

/** Which machine a workspace lives on, once the organization has devices:
 * a device by name (and whether it is reachable), else the server. */
function RunsOn({
  sessionId,
  placements,
  devices,
}: {
  sessionId: string;
  placements:
    | ReadonlyArray<{ sessionId: string; deviceId: string }>
    | undefined;
  devices: readonly SandboxDeviceView[] | undefined;
}) {
  const { t } = useT('sandboxes');
  if (devices === undefined || devices.length === 0) return null;
  const placement = placements?.find((p) => p.sessionId === sessionId);
  if (placement === undefined) {
    return (
      <span className="text-muted-foreground text-xs">
        {t('runsOn.server')}
      </span>
    );
  }
  const device = devices.find((d) => d.id === placement.deviceId);
  const name = device?.name ?? placement.deviceId.slice(0, 8);
  return (
    <span className="text-muted-foreground text-xs">
      {t(
        device?.status === 'offline' ? 'runsOn.deviceOffline' : 'runsOn.device',
        {
          name,
        },
      )}
    </span>
  );
}

/** The day the cleanup deletes a hibernated agent workspace on if nobody
 * uses it before then — dated like the Created column. Nothing for a
 * workspace no cleanup is due to delete. */
function DeletesOn({ deletesAt }: { deletesAt: number | null | undefined }) {
  const { t } = useT('sandboxes');
  const { formatDate } = useFormatDate();
  if (typeof deletesAt !== 'number') return null;
  return (
    <span className="text-muted-foreground text-xs">
      {t('status.deletesOn', {
        date: formatDate(new Date(deletesAt), 'short'),
      })}
    </span>
  );
}
