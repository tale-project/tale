import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { PageSection } from '@tale/ui/page-section';
import type { ColumnDef } from '@tanstack/react-table';
import type { FunctionReturnType } from 'convex/server';
import { Pin, PinOff, Square, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { TableDateCell } from '@/app/components/ui/data-display/table-date-cell';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
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

  const stop = useConvexAction(
    api.node_only.sandbox.session_admin_actions.stopSandboxTask,
  );
  const destroy = useConvexAction(
    api.node_only.sandbox.session_admin_actions.destroySandbox,
  );
  const setPinned = useConvexAction(
    api.node_only.sandbox.session_admin_actions.setSandboxPinned,
  );

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
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.createdBy}</span>
        ),
      },
      {
        accessorKey: 'agentKind',
        header: t('columns.agent'),
        cell: ({ row }) => row.original.agentKind ?? '—',
      },
      {
        id: 'status',
        header: t('columns.status'),
        cell: ({ row }) => {
          const s = row.original;
          const paused = s.currentOp?.pausedReason === 'budget';
          return (
            <div className="flex flex-wrap gap-1">
              {paused ? (
                <Badge variant="destructive">{t('status.pausedBudget')}</Badge>
              ) : s.busy ? (
                <Badge variant="green">{t('status.running')}</Badge>
              ) : (
                <Badge variant="outline">{t('status.idle')}</Badge>
              )}
              {s.pinned && <Badge variant="blue">{t('status.pinned')}</Badge>}
            </div>
          );
        },
      },
      {
        id: 'task',
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
            <div className="flex flex-col">
              {op.threadId && (
                <span className="font-mono text-xs">
                  {t('task.thread', { id: op.threadId.slice(0, 8) })}
                </span>
              )}
              {count > 0 && (
                <span className="text-muted-foreground text-xs">
                  {t('task.continuations', { count })}
                </span>
              )}
            </div>
          );
        },
      },
      {
        id: 'spend',
        header: t('columns.spend'),
        cell: ({ row }) => formatCents(row.original.currentOp?.spentCents),
      },
      {
        accessorKey: 'createdAt',
        header: t('columns.created'),
        cell: ({ row }) => <TableDateCell date={row.original.createdAt} />,
      },
      {
        id: 'actions',
        header: t('columns.actions'),
        cell: ({ row }) => {
          const s = row.original;
          const busy = pendingId === s.sessionId;
          return (
            <div className="flex justify-end gap-1">
              {s.busy && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      s.sessionId,
                      () =>
                        stop.mutateAsync({
                          organizationId,
                          sessionId: s.sessionId,
                        }),
                      'toast.stopped',
                    )
                  }
                >
                  <Square className="size-4" />
                  {t('actions.stop')}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void run(
                    s.sessionId,
                    () =>
                      setPinned.mutateAsync({
                        organizationId,
                        sessionId: s.sessionId,
                        pinned: !s.pinned,
                      }),
                    s.pinned ? 'toast.unpinned' : 'toast.pinned',
                  )
                }
              >
                {s.pinned ? (
                  <PinOff className="size-4" />
                ) : (
                  <Pin className="size-4" />
                )}
                {s.pinned ? t('actions.unpin') : t('actions.pin')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => setConfirmDestroy(s.sessionId)}
              >
                <Trash2 className="size-4" />
                {t('actions.destroy')}
              </Button>
            </div>
          );
        },
      },
    ],
    [t, organizationId, pendingId, stop, setPinned, run],
  );

  // Non-privileged member (or unauthenticated) → query returns null.
  if (data === null) {
    return (
      <PageSection title={t('title')}>
        <p className="text-muted-foreground text-sm">{t('accessDenied')}</p>
      </PageSection>
    );
  }

  return (
    <PageSection title={t('title')} description={t('description')}>
      <DataTable<SandboxRow>
        columns={columns}
        data={data ?? []}
        isLoading={isLoading}
        approxRowCount={data?.length}
        getRowId={(row) => row.sessionId}
        emptyState={{
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
    </PageSection>
  );
}
