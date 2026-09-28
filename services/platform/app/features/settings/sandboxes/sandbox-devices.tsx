import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { DataTable } from '@tale/ui/data-table/data-table';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { EntityRowActions } from '@tale/ui/entity/entity-row-actions';
import { Stack } from '@tale/ui/layout';
import { TableDateCell } from '@tale/ui/table-date-cell';
import { Text } from '@tale/ui/text';
import { useToast } from '@tale/ui/use-toast';
import type { ColumnDef } from '@tanstack/react-table';
import { Monitor, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useBackendMutation } from '@/app/hooks/use-backend-mutation';
import { useFormatNumber } from '@/app/hooks/use-format-number';
import { failureDetail } from '@/app/lib/backend/adapters';
import { useT } from '@/lib/i18n/client';
import type {
  SandboxDevicesView,
  SandboxDeviceStatus,
  SandboxDeviceView,
} from '@/lib/shared/schemas/sandbox-devices';

import { AddDeviceDialog } from './add-device-dialog';

interface SandboxDevicesSectionProps {
  organizationId: string;
  view: SandboxDevicesView | undefined;
  isLoading: boolean;
  error: Error | null;
  /** Admins add and remove devices; developers see them. */
  canManage: boolean;
  onRefresh: () => void;
}

const STATUS_BADGE: Record<
  SandboxDeviceStatus,
  'green' | 'blue' | 'yellow' | 'destructive' | 'outline'
> = {
  online: 'green',
  updating: 'blue',
  outdated: 'yellow',
  update_failed: 'destructive',
  offline: 'outline',
};

const OS_LABEL: Record<string, string> = {
  darwin: 'macOS',
  linux: 'Linux',
  win32: 'Windows',
};

/**
 * Settings > Sandboxes > Devices: the machines this organization connected
 * with `tale sandbox connect` to run its sandboxes on its own hardware, how
 * each is doing, and the one-line command that adds another.
 */
export function SandboxDevicesSection({
  organizationId,
  view,
  isLoading,
  error,
  canManage,
  onRefresh,
}: SandboxDevicesSectionProps) {
  const { t } = useT('sandboxes');
  const { toast } = useToast();
  const { formatNumber } = useFormatNumber();
  const remove = useBackendMutation('sandbox_devices/mutations:remove', {
    errorToast: false,
  });
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<SandboxDeviceView | null>(null);
  const devices = view?.devices ?? [];

  const columns = useMemo<ColumnDef<SandboxDeviceView>[]>(
    () => [
      {
        accessorKey: 'name',
        header: t('devices.columns.name'),
        // Seven columns summing to 734 px — inside the settings pane in
        // every shipped locale, like the workspace table below.
        size: 150,
        meta: { skeleton: { type: 'two-line' } },
        cell: ({ row }) => {
          const d = row.original;
          return (
            <Stack gap={0} className="min-w-0">
              <span className="truncate font-medium">{d.name}</span>
              {d.platform && (
                <span className="text-muted-foreground truncate text-xs">
                  {t('devices.platform', {
                    os: OS_LABEL[d.platform.os] ?? d.platform.os,
                    arch: d.platform.arch,
                  })}
                </span>
              )}
            </Stack>
          );
        },
      },
      {
        id: 'status',
        header: t('devices.columns.status'),
        size: 130,
        meta: { skeleton: { type: 'badge-text', lineGap: 1 } },
        cell: ({ row }) => {
          const d = row.original;
          const target = d.update?.targetVersion ?? '';
          return (
            <Stack gap={1} className="min-w-0">
              <div>
                <Badge variant={STATUS_BADGE[d.status]}>
                  {t(`devices.status.${d.status}`)}
                </Badge>
              </div>
              {d.status === 'updating' && target !== '' && (
                <span className="text-muted-foreground text-xs">
                  {t('devices.updatingTo', { version: target })}
                </span>
              )}
              {d.status === 'update_failed' && (
                <>
                  <span className="text-muted-foreground text-xs">
                    {t('devices.updateFailedHint', { version: target })}
                  </span>
                  {/* The reason itself, readable by everyone (a tooltip is
                      out of reach for keyboard and screen-reader users). */}
                  {d.update?.error && (
                    <span className="text-muted-foreground line-clamp-3 text-xs break-words">
                      {d.update.error}
                    </span>
                  )}
                </>
              )}
              {d.status === 'outdated' && (
                <span className="text-muted-foreground text-xs">
                  {t('devices.outdatedHint', {
                    version: view?.serverVersion ?? '',
                  })}
                </span>
              )}
            </Stack>
          );
        },
      },
      {
        id: 'sandboxes',
        header: t('devices.columns.sandboxes'),
        size: 90,
        cell: ({ row }) => {
          const d = row.original;
          if (d.maxSessions === null) return '—';
          const used =
            d.sessions === null
              ? '—'
              : formatNumber(d.sessions.running + d.sessions.starting);
          return (
            <span className="tabular-nums">
              {t('devices.sandboxCount', {
                used,
                limit: formatNumber(d.maxSessions),
              })}
            </span>
          );
        },
      },
      {
        id: 'machine',
        header: t('devices.columns.machine'),
        size: 140,
        cell: ({ row }) => {
          const p = row.original.platform;
          if (!p?.cpus || !p.memoryBytes) return '—';
          return (
            <span className="whitespace-nowrap tabular-nums">
              {t('devices.machine', {
                cpus: p.cpus,
                memory: formatNumber(p.memoryBytes / 1024 ** 3, {
                  maximumFractionDigits: 0,
                }),
              })}
            </span>
          );
        },
      },
      {
        accessorKey: 'version',
        header: t('devices.columns.version'),
        size: 80,
        cell: ({ row }) =>
          row.original.version === null ? (
            '—'
          ) : (
            <span className="font-mono text-xs">{row.original.version}</span>
          ),
      },
      {
        accessorKey: 'lastSeenAt',
        header: t('devices.columns.lastSeen'),
        size: 100,
        // A connected device is seen now; an offline one says when it left.
        cell: ({ row }) =>
          row.original.status !== 'offline' ? (
            t('devices.lastSeenNow')
          ) : row.original.lastSeenAt === null ? (
            '—'
          ) : (
            <TableDateCell date={row.original.lastSeenAt} preset="relative" />
          ),
      },
      ...(canManage
        ? [
            {
              id: 'actions',
              size: 44,
              meta: { isAction: true },
              // Empty like every entity table's row-action column: the
              // DataTable supplies the screen-reader label.
              header: '',
              cell: ({ row }) => (
                <EntityRowActions
                  actions={[
                    {
                      key: 'remove',
                      label: t('devices.actions.remove'),
                      icon: Trash2,
                      destructive: true,
                      onClick: () => setRemoving(row.original),
                    },
                  ]}
                />
              ),
            } satisfies ColumnDef<SandboxDeviceView>,
          ]
        : []),
    ],
    [t, canManage, formatNumber, view?.serverVersion],
  );

  const hubNotice =
    view?.hub === 'not_configured'
      ? t('devices.hub.notConfigured')
      : view?.hub === 'unavailable'
        ? t('devices.hub.unavailable')
        : null;

  return (
    <SettingsSection
      title={t('devices.title')}
      description={t('devices.description')}
      action={
        canManage ? (
          <Button
            size="sm"
            icon={Plus}
            onClick={() => setAdding(true)}
            disabled={view?.hub === 'not_configured'}
          >
            {t('devices.add')}
          </Button>
        ) : undefined
      }
    >
      {hubNotice !== null && (
        <Text as="p" role="status" variant="muted" className="text-sm">
          {hubNotice}
        </Text>
      )}
      <DataTable<SandboxDeviceView>
        columns={columns}
        data={devices}
        isLoading={isLoading}
        error={error}
        approxRowCount={devices.length}
        getRowId={(row) => row.id}
        emptyState={{
          icon: Monitor,
          title: t('devices.empty.title'),
          description: t('devices.empty.description'),
        }}
        caption={t('devices.title')}
      />
      {canManage && (
        <>
          <AddDeviceDialog
            organizationId={organizationId}
            open={adding}
            onOpenChange={setAdding}
            devices={devices}
            serverVersion={view?.serverVersion ?? 'dev'}
            onRefresh={onRefresh}
          />
          <ConfirmDialog
            open={removing !== null}
            onOpenChange={(open) => {
              if (!open) setRemoving(null);
            }}
            title={t('devices.removeConfirm.title', {
              name: removing?.name ?? '',
            })}
            description={t('devices.removeConfirm.description')}
            confirmText={t('devices.removeConfirm.confirm')}
            variant="destructive"
            isLoading={remove.isPending}
            onConfirm={() => {
              const target = removing;
              if (target === null) return;
              remove.mutateAsync({ organizationId, deviceId: target.id }).then(
                () => {
                  toast({ title: t('devices.toast.removed') });
                  setRemoving(null);
                },
                (err: unknown) => {
                  toast({
                    title: t('devices.toast.error'),
                    description: failureDetail(err),
                    variant: 'destructive',
                  });
                },
              );
            }}
          />
        </>
      )}
    </SettingsSection>
  );
}
