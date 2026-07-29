import { Badge } from '@tale/ui/badge';
import { Row, Stack } from '@tale/ui/layout';
import type { ColumnDef } from '@tanstack/react-table';
import type { FunctionReturnType } from 'convex/server';
import { Box, Pin, PinOff, Square, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { TableDateCell } from '@/app/components/ui/data-display/table-date-cell';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { EntityRowActions } from '@/app/components/ui/entity/entity-row-actions';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useToast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

type SandboxList = NonNullable<
  FunctionReturnType<
    typeof api.sandbox.session_queries_public.listSandboxesForOrg
  >
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

  const { data, isLoading } = useConvexQuery(
    api.sandbox.session_queries_public.listSandboxesForOrg,
    { organizationId },
  );

  // Per-budget session usage vs cap — the soft-warning surface before a hard
  // refusal. Reactive, so it tracks sessions coming and going live.
  const quota = useConvexQuery(
    api.sandbox.session_queries_public.getSandboxQuotaUsage,
    { organizationId },
  );

  const stop = useConvexAction(
    api.node_only.sandbox.session_admin_actions.stopSandboxTask,
  );
  const destroy = useConvexAction(
    api.node_only.sandbox.session_admin_actions.destroySandbox,
  );
  const setPinned = useConvexAction(
    api.node_only.sandbox.session_admin_actions.setSandboxPinned,
  );

  // Reconcile platform rows with the spawner on mount so a session the idle/TTL
  // reaper released shows as "Stopped" rather than a stale "Idle". The spawner
  // is pull-only (no lifecycle callback), so this opportunistic probe — not a
  // cron — is what keeps the fleet view honest. Fire-and-forget; the action
  // logs its own per-session failures.
  const reconcile = useConvexAction(
    api.node_only.sandbox.session_admin_actions.reconcileOrgSessions,
  );
  const reconcileMutate = reconcile.mutate;
  useEffect(() => {
    reconcileMutate({ organizationId });
  }, [organizationId, reconcileMutate]);

  // The session id whose control is mid-flight (disables that row's buttons).
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmDestroy, setConfirmDestroy] = useState<string | null>(null);

  const run = useCallback(
    async (
      sessionId: string,
      fn: () => Promise<unknown>,
      successKey: string,
    ): Promise<void> => {
      setPendingId(sessionId);
      try {
        await fn();
        toast({ title: t(successKey) });
      } catch (err) {
        toast({
          title: t('toast.error'),
          description: err instanceof Error ? err.message : String(err),
          variant: 'destructive',
        });
      } finally {
        setPendingId(null);
      }
    },
    [t, toast],
  );

  const columns = useMemo<ColumnDef<SandboxRow>[]>(
    () => [
      {
        accessorKey: 'createdBy',
        header: t('columns.owner'),
        size: 150,
        cell: ({ row }) => {
          const s = row.original;
          // Name + email when resolved; fall back to the raw id (system-owned /
          // deleted user). Constrained width + truncate so a long id/email can't
          // bleed into the Agent column.
          return (
            <Stack gap={0} className="max-w-[220px] min-w-0">
              <span className="truncate font-medium">
                {s.ownerName ?? s.ownerEmail ?? s.createdBy}
              </span>
              {s.ownerEmail && s.ownerName && (
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
        size: 95,
        cell: ({ row }) => row.original.agentKind ?? '—',
      },
      {
        id: 'status',
        size: 85,
        header: t('columns.status'),
        cell: ({ row }) => {
          const s = row.original;
          const paused = s.currentOp?.pausedReason === 'budget';
          // `stopped` = compute released, workspace preserved (hibernated). It's
          // never busy, so check it before the busy/idle branch — otherwise it
          // would mislabel as "Idle" (which means a live, non-busy container).
          const stopped = s.status === 'stopped';
          return (
            <Row gap={1} align="stretch" wrap>
              {paused ? (
                <Badge variant="destructive">{t('status.pausedBudget')}</Badge>
              ) : stopped ? (
                <Badge variant="yellow">{t('status.stopped')}</Badge>
              ) : s.busy ? (
                <Badge variant="green">{t('status.running')}</Badge>
              ) : (
                <Badge variant="outline">{t('status.idle')}</Badge>
              )}
              {s.pinned && <Badge variant="blue">{t('status.pinned')}</Badge>}
            </Row>
          );
        },
      },
      {
        id: 'task',
        size: 150,
        header: t('columns.task'),
        cell: ({ row }) => {
          const op = row.original.currentOp;
          if (!op) {
            return (
              <span className="text-muted-foreground">{t('task.none')}</span>
            );
          }
          const count = op.continuationCount ?? 0;
          return (
            <Stack gap={0}>
              {op.threadId && (
                <span className="text-xs">
                  {t('task.thread')}{' '}
                  <span className="font-mono">{op.threadId.slice(0, 8)}</span>
                </span>
              )}
              {count > 0 && (
                <span className="text-muted-foreground text-xs">
                  {count} {t('task.continuations')}
                </span>
              )}
            </Stack>
          );
        },
      },
      {
        id: 'spend',
        size: 75,
        header: t('columns.spend'),
        // Cumulative spend across every task this sandbox has run. `|| undefined`
        // renders a never-billed sandbox as "—" rather than a misleading $0.00.
        cell: ({ row }) =>
          formatCents(row.original.totalSpentCents || undefined),
      },
      {
        accessorKey: 'createdAt',
        header: t('columns.created'),
        size: 95,
        cell: ({ row }) => <TableDateCell date={row.original.createdAt} />,
      },
      {
        id: 'actions',
        size: 44,
        meta: { isAction: true },
        header: t('columns.actions'),
        cell: ({ row }) => {
          const s = row.original;
          const busy = pendingId === s.sessionId;
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
                    disabled: busy,
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
                    disabled: busy,
                    onClick: () => setConfirmDestroy(s.sessionId),
                  },
                ]}
              />
            </Row>
          );
        },
      },
    ],
    [t, organizationId, pendingId, stop, setPinned, run],
  );

  // Non-privileged member (or unauthenticated) → query returns null.
  if (data === null) {
    return <AccessDenied message={t('accessDenied')} />;
  }

  const quotaRows = quota.data ?? [];

  return (
    <SettingsSection title={t('title')} description={t('description')}>
      {quotaRows.length > 0 && (
        <Row gap={2} wrap className="mb-4">
          {quotaRows.map((b) => (
            <Badge
              key={b.budget}
              variant={
                b.atLimit ? 'destructive' : b.nearLimit ? 'yellow' : 'slate'
              }
            >
              {t(`quota.budgets.${b.budget}`)}: {b.used} / {b.cap}
            </Badge>
          ))}
        </Row>
      )}
      <DataTable<SandboxRow>
        columns={columns}
        data={data ?? []}
        isLoading={isLoading}
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
        open={confirmDestroy !== null}
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
            'toast.destroyed',
          ).finally(() => setConfirmDestroy(null));
        }}
      />
    </SettingsSection>
  );
}
