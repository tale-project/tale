import {
  isDockerEngineBelowFloor,
  MIN_DOCKER_ENGINE_MAJOR,
} from '@tale/shared/docker-engine';
import { Badge } from '@tale/ui/badge';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { DataTable } from '@tale/ui/data-table/data-table';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { EntityRowActions } from '@tale/ui/entity/entity-row-actions';
import { Stack } from '@tale/ui/layout';
import { TableDateCell } from '@tale/ui/table-date-cell';
import { Text } from '@tale/ui/text';
import { DEFAULT_LIST_PAGE_SIZE, useListPage } from '@tale/ui/use-list-page';
import { useToast } from '@tale/ui/use-toast';
import type { ColumnDef } from '@tanstack/react-table';
import { Monitor, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useBackendMutation } from '@/app/hooks/use-backend-mutation';
import { useFormatNumber } from '@/app/hooks/use-format-number';
import { useListReadRecovery } from '@/app/hooks/use-list-read-recovery';
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
  /** The last read that worked: a failed refresh leaves its rows listed. */
  view: SandboxDevicesView | undefined;
  error: Error | null;
  /** A re-read runs, after a failure, with rows on screen. */
  isRetrying: boolean;
  /** Changes with each failed read, so a repeated failure is announced. */
  failureCount: number;
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
  error,
  isRetrying,
  failureCount,
  canManage,
  onRefresh,
}: SandboxDevicesSectionProps) {
  const { t } = useT('sandboxes');
  const { t: tCommon } = useT('common');
  const { toast } = useToast();
  const { formatNumber } = useFormatNumber();
  const remove = useBackendMutation('sandbox_devices/mutations:remove', {
    errorToast: false,
  });
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<SandboxDeviceView | null>(null);
  const devices = view?.devices ?? [];
  // Try again re-reads the devices: in the table's error state, the section
  // takes the focus the button held while the table loads again; with rows
  // on screen, the alert above them names the failed refresh.
  const recovery = useListReadRecovery<HTMLElement>({
    error,
    results: devices,
    retry: onRefresh,
  });

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
          const engine = d.platform?.dockerVersion;
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
                <span className="text-muted-foreground text-xs">
                  {t('devices.updateFailedHint', { version: target })}
                </span>
              )}
              {d.status === 'outdated' && (
                <span className="text-muted-foreground text-xs">
                  {t('devices.outdatedHint', {
                    version: view?.serverVersion ?? '',
                  })}
                </span>
              )}
              {/* tale sandbox update refuses an engine below the floor, and
                  one too old for zstd layers fails every automatic update
                  with Docker's own pull error: name the cause before it. */}
              {isDockerEngineBelowFloor(engine) && (
                <span className="text-muted-foreground text-xs">
                  {t('devices.engineTooOld', {
                    version: engine,
                    minimum: `${MIN_DOCKER_ENGINE_MAJOR}.0`,
                  })}
                </span>
              )}
              {/* The reason itself, readable by everyone (a tooltip is
                  out of reach for keyboard and screen-reader users). */}
              {d.status === 'update_failed' && d.update?.error && (
                <span className="text-muted-foreground line-clamp-3 text-xs break-words">
                  {d.update.error}
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

  const list = useListPage<SandboxDeviceView>({
    dataSource: {
      type: 'query',
      data: view?.devices,
      error,
      retry: recovery.retryRead,
    },
    pageSize: DEFAULT_LIST_PAGE_SIZE,
    // What a reader looks a device up by: its name, its system as the
    // Device column names it, and the Tale release it runs.
    search: {
      fields: [
        'name',
        (d) =>
          d.platform === null
            ? undefined
            : (OS_LABEL[d.platform.os] ?? d.platform.os),
        'version',
      ],
      placeholder: t('devices.searchPlaceholder'),
    },
    getRowId: (row) => row.id,
    entityLabel: {
      one: t('devices.entityLabelOne'),
      other: t('devices.entityLabel'),
    },
  });

  const hubNotice =
    view?.hub === 'not_configured'
      ? t('devices.hub.notConfigured')
      : view?.hub === 'unavailable'
        ? t('devices.hub.unavailable')
        : null;

  return (
    <SettingsSection
      ref={recovery.regionRef}
      tabIndex={-1}
      title={t('devices.title')}
      description={t('devices.description')}
    >
      {hubNotice !== null && (
        <Text as="p" role="status" variant="muted" className="text-sm">
          {hubNotice}
        </Text>
      )}
      {recovery.failedWithRows && (
        <CatalogLoadError
          message={tCommon('errors.errorLoadingPage')}
          onRetry={recovery.retryRead}
          isRetrying={isRetrying}
          failureKey={failureCount}
          onFocusLost={recovery.focusRegion}
        />
      )}
      <DataTable<SandboxDeviceView>
        columns={columns}
        onErrorFocusLost={recovery.focusRegion}
        addAction={
          canManage
            ? {
                label: t('devices.add'),
                icon: Plus,
                onClick: () => setAdding(true),
                // A sandbox service that takes no devices has nothing to
                // connect one to.
                disabled: view?.hub === 'not_configured',
              }
            : undefined
        }
        emptyState={{
          icon: Monitor,
          title: t('devices.empty.title'),
          description: t('devices.empty.description'),
        }}
        caption={t('devices.title')}
        {...list.tableProps}
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
