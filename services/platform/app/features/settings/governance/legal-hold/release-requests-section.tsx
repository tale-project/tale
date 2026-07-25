'use client';

import { Badge } from '@tale/ui/badge';
import { IconButton } from '@tale/ui/icon-button';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import type { ColumnDef } from '@tanstack/react-table';
import { Check, Inbox, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import { TableDateCell } from '@/app/components/ui/data-display/table-date-cell';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useCurrentUser } from '@/app/hooks/use-current-user';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useLegalHoldReleaseRequests } from '../hooks/queries';
import { ApproveReleaseDialog } from './approve-release-dialog';
import { CountdownBadge } from './countdown-badge';
import { RejectReleaseDialog } from './reject-release-dialog';

type ReleaseRow = NonNullable<
  ReturnType<typeof useLegalHoldReleaseRequests>['data']
>[number];

interface ReleaseRequestsSectionProps {
  organizationId: string;
}

export function ReleaseRequestsSection({
  organizationId,
}: ReleaseRequestsSectionProps) {
  const { t } = useT('governance');
  const { data: currentUser } = useCurrentUser();

  const pending = useLegalHoldReleaseRequests(organizationId, 'pending');
  const approved = useLegalHoldReleaseRequests(organizationId, 'approved');

  const [approveTarget, setApproveTarget] = useState<ReleaseRow | null>(null);
  const [rejectId, setRejectId] = useState<
    Id<'legalHoldReleaseRequests'> | undefined
  >(undefined);

  const pendingColumns = useMemo<ColumnDef<ReleaseRow>[]>(
    () => [
      {
        accessorKey: 'targetType',
        header: t('legalHold.columns.target'),
        cell: ({ row }) => (
          <Stack gap={0}>
            {row.original.targetType && (
              <Badge variant="outline" className="self-start">
                {t(`legalHold.targetTypes.${row.original.targetType}`)}
              </Badge>
            )}
            <Text
              as="span"
              variant="muted"
              truncate
              className="font-mono text-xs"
              title={row.original.targetId ?? row.original.holdId}
            >
              {row.original.targetId ?? row.original.holdId}
            </Text>
          </Stack>
        ),
        meta: { skeleton: { type: 'two-line' as const } },
        size: 200,
      },
      {
        accessorKey: 'reason',
        header: t('legalHold.columns.reason'),
        cell: ({ row }) => (
          <Text as="span" truncate title={row.original.reason}>
            {row.original.reason}
          </Text>
        ),
      },
      {
        accessorKey: 'requestedByName',
        header: t('legalHold.columns.requestedBy'),
        cell: ({ row }) => (
          <Text as="span" truncate>
            {row.original.requestedByName}
          </Text>
        ),
        size: 160,
      },
      {
        accessorKey: 'requestedAt',
        header: t('legalHold.columns.requestedAt'),
        cell: ({ row }) => <TableDateCell date={row.original.requestedAt} />,
        size: 160,
      },
      {
        id: 'actions',
        header: t('legalHold.columns.actions'),
        meta: { isAction: true, align: 'right' as const },
        cell: ({ row }) => {
          const isSelf = currentUser?.userId === row.original.requestedBy;
          return (
            <Row gap={1} align="stretch" justify="end">
              <IconButton
                type="button"
                variant="ghost"
                size="sm"
                icon={Check}
                aria-label={t('legalHold.actions.approve')}
                tooltip={
                  isSelf
                    ? t('legalHold.dialogs.approveRelease.selfApproveBlocked')
                    : undefined
                }
                onClick={(e) => {
                  e.stopPropagation();
                  setApproveTarget(row.original);
                }}
              />
              <IconButton
                type="button"
                variant="ghost"
                size="sm"
                icon={X}
                aria-label={t('legalHold.actions.reject')}
                onClick={(e) => {
                  e.stopPropagation();
                  setRejectId(row.original._id);
                }}
              />
            </Row>
          );
        },
        size: 200,
      },
    ],
    [t, currentUser?.userId],
  );

  const approvedColumns = useMemo<ColumnDef<ReleaseRow>[]>(
    () => [
      {
        accessorKey: 'targetType',
        header: t('legalHold.columns.target'),
        cell: ({ row }) => (
          <Stack gap={0}>
            {row.original.targetType && (
              <Badge variant="outline" className="self-start">
                {t(`legalHold.targetTypes.${row.original.targetType}`)}
              </Badge>
            )}
            <Text
              as="span"
              variant="muted"
              truncate
              className="font-mono text-xs"
              title={row.original.targetId ?? row.original.holdId}
            >
              {row.original.targetId ?? row.original.holdId}
            </Text>
          </Stack>
        ),
        meta: { skeleton: { type: 'two-line' as const } },
        size: 200,
      },
      {
        accessorKey: 'requestedByName',
        header: t('legalHold.columns.requestedBy'),
        cell: ({ row }) => row.original.requestedByName,
        size: 160,
      },
      {
        accessorKey: 'approvedByName',
        header: t('legalHold.columns.approvedBy'),
        cell: ({ row }) => row.original.approvedByName ?? '—',
        size: 160,
      },
      {
        accessorKey: 'effectiveAt',
        header: t('legalHold.columns.effectiveAt'),
        cell: ({ row }) =>
          row.original.effectiveAt !== undefined ? (
            <CountdownBadge effectiveAt={row.original.effectiveAt} />
          ) : (
            '—'
          ),
        size: 200,
      },
    ],
    [t],
  );

  return (
    <>
      <SettingsSection
        title={t('legalHold.sections.releaseRequests.title')}
        description={t('legalHold.sections.releaseRequests.description')}
      >
        <Stack gap={6}>
          <div>
            <Text variant="label" className="mb-2 text-sm">
              {t('legalHold.sections.releaseRequests.pendingHeader')}
            </Text>
            <DataTable<ReleaseRow>
              columns={pendingColumns}
              data={pending.data ?? []}
              isLoading={pending.isLoading}
              approxRowCount={pending.data?.length}
              getRowId={(row) => row._id}
              emptyState={{
                icon: Inbox,
                title: t('legalHold.sections.releaseRequests.empty.title'),
                description: t(
                  'legalHold.sections.releaseRequests.empty.description',
                ),
              }}
              caption={t('legalHold.sections.releaseRequests.pendingHeader')}
            />
          </div>
          {/* Hairline between the two request buckets — without it the
              approved list read as more rows of the pending table. */}
          <div className="border-border border-t pt-6">
            <Text variant="label" className="mb-2 text-sm">
              {t('legalHold.sections.releaseRequests.approvedHeader')}
            </Text>
            <DataTable<ReleaseRow>
              columns={approvedColumns}
              data={approved.data ?? []}
              isLoading={approved.isLoading}
              approxRowCount={approved.data?.length}
              getRowId={(row) => row._id}
              emptyState={{
                icon: Inbox,
                title: t('legalHold.sections.releaseRequests.empty.title'),
                description: t(
                  'legalHold.sections.releaseRequests.empty.description',
                ),
              }}
              caption={t('legalHold.sections.releaseRequests.approvedHeader')}
            />
          </div>
        </Stack>
      </SettingsSection>

      <ApproveReleaseDialog
        open={approveTarget !== null}
        onOpenChange={(next) => {
          if (!next) setApproveTarget(null);
        }}
        request={approveTarget}
        currentUserId={currentUser?.userId}
      />
      <RejectReleaseDialog
        open={rejectId !== undefined}
        onOpenChange={(next) => {
          if (!next) setRejectId(undefined);
        }}
        requestId={rejectId}
      />
    </>
  );
}
