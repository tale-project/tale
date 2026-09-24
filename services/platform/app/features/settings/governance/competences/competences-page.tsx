'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { DataTable } from '@tale/ui/data-table/data-table';
import type { FilterConfig } from '@tale/ui/data-table/data-table-filters';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { TableDateCell } from '@tale/ui/table-date-cell';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { useToast } from '@tale/ui/use-toast';
import type { ColumnDef } from '@tanstack/react-table';
import { BadgeCheck, Ban, Plus } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useMembers } from '@/app/features/settings/organization/hooks/queries';
import { useAbility } from '@/app/hooks/use-ability';
import type { CompetenceRecordWire } from '@/app/lib/backend/contract/governance';
import { useT } from '@/lib/i18n/client';
import {
  type CompetenceRecordStatus,
  competenceRecordStatus,
  isPlatformCapability,
} from '@/lib/shared/competences';

import { useRevokeCompetence } from '../hooks/mutations';
import { useCompetences } from '../hooks/queries';
import { mapCompetenceError } from './competence-errors';
import { capabilityMessageKey } from './competence-labels';
import { GrantCompetenceDialog } from './grant-competence-dialog';

const STATUSES: readonly CompetenceRecordStatus[] = [
  'active',
  'expired',
  'revoked',
];

/** A stable "no filter", so the memos below do not refire every render. */
const NO_STATUS_FILTER: CompetenceRecordStatus[] = [];

const STATUS_BADGE = {
  active: 'green',
  expired: 'orange',
  revoked: 'outline',
} as const satisfies Record<CompetenceRecordStatus, string>;

interface Person {
  name: string;
  email: string | null;
}

interface CompetenceRow {
  record: CompetenceRecordWire;
  status: CompetenceRecordStatus;
  holder: Person;
  grantor: Person;
  /** The capability's translated name; null for an organization's own
   * qualification, which is shown by its name alone. */
  capabilityLabel: string | null;
  /** Who ended a revoked grant, for the date's tooltip. */
  revoker: string | undefined;
}

interface Props {
  organizationId: string;
}

/**
 * Settings → Governance → Competences: the organization's competence
 * register. Admins grant a member one platform capability (a narrow right
 * without an admin seat) or a qualification a review policy asks for, and
 * revoke it; revoked and expired grants stay listed as the audit trail.
 */
export function CompetencesPage({ organizationId }: Props) {
  const { t } = useT('governance');
  const { t: tCommon } = useT('common');
  const ability = useAbility();
  const { toast } = useToast();

  const competences = useCompetences(organizationId);
  const { members, isLoading: membersLoading } = useMembers(organizationId);
  const revokeMutation = useRevokeCompetence();

  // Active grants are what an admin comes to check; history is one filter away.
  const [statusFilter, setStatusFilter] = useState<CompetenceRecordStatus[]>([
    'active',
  ]);
  const [grantOpen, setGrantOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<CompetenceRow | null>(null);
  const [revoking, setRevoking] = useState(false);
  // A revoked row can leave the filtered list; focus then returns to the table.
  const tableRegionRef = useRef<HTMLDivElement>(null);

  const people = useMemo(() => {
    const map = new Map<string, Person>();
    for (const member of members ?? []) {
      map.set(member.userId, {
        name: member.displayName ?? member.email ?? member.userId,
        email: member.email ?? null,
      });
    }
    return map;
  }, [members]);

  const rows = useMemo<CompetenceRow[]>(() => {
    const now = Date.now();
    // Someone missing from a loaded directory has left the organization;
    // without a directory (it failed to load) the id is all there is.
    const personOf = (userId: string): Person =>
      people.get(userId) ?? {
        name: members === undefined ? userId : t('competences.formerMember'),
        email: null,
      };
    return (competences.data ?? []).map((record) => ({
      record,
      status: competenceRecordStatus(record, now),
      holder: personOf(record.userId),
      grantor: personOf(record.grantedBy),
      capabilityLabel: isPlatformCapability(record.competence)
        ? t(
            `competences.capabilities.${capabilityMessageKey(record.competence)}.label`,
          )
        : null,
      // An admin revoked it, or the register did when a new grant replaced
      // one that had expired (`revokedBy` = `system`).
      revoker:
        record.revokedBy === null
          ? undefined
          : record.revokedBy === 'system'
            ? t('competences.revokedBySystem')
            : t('competences.revokedBy', {
                name: personOf(record.revokedBy).name,
              }),
    }));
  }, [competences.data, members, people, t]);

  // An empty register shows its empty state, not "no results" for the
  // default Active filter; the filter applies once there is anything to sift.
  const effectiveFilter = rows.length === 0 ? NO_STATUS_FILTER : statusFilter;
  const visibleRows = useMemo(
    () =>
      effectiveFilter.length === 0
        ? rows
        : rows.filter((row) => effectiveFilter.includes(row.status)),
    [rows, effectiveFilter],
  );

  const handleStatusChange = useCallback((values: string[]) => {
    setStatusFilter(STATUSES.filter((status) => values.includes(status)));
  }, []);

  const filterConfigs = useMemo<FilterConfig[]>(
    () => [
      {
        key: 'status',
        title: t('competences.columns.status'),
        multiSelect: true,
        options: STATUSES.map((status) => ({
          value: status,
          label: t(`competences.status.${status}`),
        })),
        selectedValues: effectiveFilter,
        onChange: handleStatusChange,
      },
    ],
    [t, effectiveFilter, handleStatusChange],
  );

  const competenceName = useCallback(
    (row: CompetenceRow) => row.capabilityLabel ?? row.record.competence,
    [],
  );

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await revokeMutation.mutateAsync({
        organizationId,
        recordId: revokeTarget.record.id,
      });
      // Close only once the list shows the revocation: the row's Revoke
      // button is gone by then, so focus lands on the table region instead
      // of falling back to the page body.
      await competences.refetch();
      toast({ title: t('competences.toasts.revoked'), variant: 'success' });
      setRevokeTarget(null);
    } catch (err) {
      toast({
        title: t('competences.toasts.revokeFailed'),
        description: mapCompetenceError(err, t),
        variant: 'destructive',
      });
    } finally {
      setRevoking(false);
    }
  };

  const columns = useMemo<ColumnDef<CompetenceRow>[]>(
    () => [
      {
        id: 'member',
        header: t('competences.columns.member'),
        meta: { flex: true },
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col">
            <Text as="span" truncate title={row.original.holder.name}>
              {row.original.holder.name}
            </Text>
            {row.original.holder.email !== null &&
              row.original.holder.email !== row.original.holder.name && (
                <Text
                  as="span"
                  variant="muted"
                  truncate
                  className="text-xs"
                  title={row.original.holder.email}
                >
                  {row.original.holder.email}
                </Text>
              )}
          </div>
        ),
        size: 150,
      },
      {
        id: 'competence',
        header: t('competences.columns.competence'),
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col">
            {row.original.capabilityLabel !== null && (
              <Text as="span" truncate title={row.original.capabilityLabel}>
                {row.original.capabilityLabel}
              </Text>
            )}
            <Text
              as="span"
              variant={
                row.original.capabilityLabel === null ? undefined : 'muted'
              }
              truncate
              className="font-mono text-xs"
              title={row.original.record.competence}
            >
              {row.original.record.competence}
            </Text>
          </div>
        ),
        size: 200,
      },
      {
        id: 'status',
        header: t('competences.columns.status'),
        cell: ({ row }) => <CompetenceStatusCell row={row.original} />,
        meta: { skeleton: { type: 'badge' as const } },
        size: 170,
      },
      {
        id: 'granted',
        header: t('competences.columns.granted'),
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col">
            <TableDateCell
              date={row.original.record.grantedAt}
              className="text-xs"
            />
            <Text
              as="span"
              variant="muted"
              truncate
              className="text-xs"
              title={row.original.grantor.name}
            >
              {t('competences.grantedBy', { name: row.original.grantor.name })}
            </Text>
          </div>
        ),
        size: 150,
      },
      {
        id: 'evidence',
        header: t('competences.columns.evidence'),
        cell: ({ row }) => (
          <Text
            as="span"
            variant="muted"
            truncate
            className="block text-xs"
            title={row.original.record.evidence ?? undefined}
          >
            {row.original.record.evidence ?? '—'}
          </Text>
        ),
        size: 120,
      },
      {
        id: 'actions',
        header: () => (
          <span className="sr-only">{t('competences.columns.actions')}</span>
        ),
        meta: { isAction: true },
        // Sized for the widest label across locales ("Widerrufen", ~154px
        // rendered with its icon and the cell padding).
        size: 160,
        cell: ({ row }) =>
          row.original.status === 'active' ? (
            <Button
              variant="secondary"
              icon={Ban}
              aria-label={t('competences.actions.revokeFor', {
                competence: competenceName(row.original),
                member: row.original.holder.name,
              })}
              onClick={() => setRevokeTarget(row.original)}
            >
              {/* Icon-only on mobile; the aria-label keeps the full name. */}
              <span className="max-sm:sr-only">
                {t('competences.actions.revoke')}
              </span>
            </Button>
          ) : null,
      },
    ],
    [t, competenceName],
  );

  // Access gate is a real authorization branch, not a loading swap: only
  // owners and admins may read or write the register's settings screen.
  if (ability.cannot('write', 'orgSettings')) {
    return <AccessDenied message={t('competences.accessDenied')} />;
  }

  return (
    <>
      {/* `fullWidth` + `fitToContainer`: six columns need more than the
          `max-w-3xl` settings measure, and the bounded height lets the
          `stickyLayout` table scroll its own rows (the Trash page's frame). */}
      <SettingsPage fitToContainer fullWidth>
        <SettingsSection
          title={t('competences.title')}
          description={t('competences.description')}
          className="min-h-0 flex-1"
        >
          <div
            ref={tableRegionRef}
            tabIndex={-1}
            aria-label={t('competences.title')}
            className="flex min-h-0 flex-1 flex-col outline-none"
          >
            <DataTable<CompetenceRow>
              columns={columns}
              stickyLayout
              data={visibleRows}
              // Names come from the member directory: wait for it too, so no
              // row flashes "Former member" before the names arrive.
              isLoading={competences.isLoading || membersLoading}
              approxRowCount={
                competences.data === undefined || membersLoading
                  ? undefined
                  : visibleRows.length
              }
              error={competences.error}
              onRetry={() => void competences.refetch()}
              getRowId={(row) => row.record.id}
              filters={filterConfigs}
              onClearFilters={() => setStatusFilter([])}
              addAction={{
                label: t('competences.actions.grant'),
                icon: Plus,
                onClick: () => setGrantOpen(true),
              }}
              emptyState={{
                icon: BadgeCheck,
                title: t('competences.empty.title'),
                description: t('competences.empty.description'),
              }}
              caption={t('competences.title')}
            />
          </div>
        </SettingsSection>
      </SettingsPage>

      <GrantCompetenceDialog
        open={grantOpen}
        onOpenChange={setGrantOpen}
        organizationId={organizationId}
      />

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
        variant="destructive"
        title={t('competences.revokeDialog.title')}
        description={
          revokeTarget
            ? t('competences.revokeDialog.description', {
                competence: competenceName(revokeTarget),
                member: revokeTarget.holder.name,
              })
            : undefined
        }
        confirmText={t('competences.revokeDialog.confirm')}
        cancelText={tCommon('actions.cancel')}
        isLoading={revoking}
        onConfirm={() => void handleRevoke()}
        restoreFocusRef={tableRegionRef}
      />
    </>
  );
}

/**
 * The badge says where a grant stands; the line under it says until when
 * (active) or since when (expired, revoked). Its own component so the date
 * formatter's locale load re-renders the cell, not the column set.
 */
function CompetenceStatusCell({ row }: { row: CompetenceRow }) {
  const { t } = useT('governance');
  const { formatDate } = useFormatDate();
  const { record, status } = row;
  const detail =
    status === 'revoked' && record.revokedAt !== null
      ? formatDate(new Date(record.revokedAt), 'short')
      : record.expiresAt === null
        ? t('competences.statusDetail.noExpiry')
        : status === 'active'
          ? t('competences.statusDetail.until', {
              date: formatDate(new Date(record.expiresAt), 'short'),
            })
          : formatDate(new Date(record.expiresAt), 'short');
  return (
    <div className="flex min-w-0 flex-col items-start gap-0.5">
      <Badge variant={STATUS_BADGE[status]}>
        {t(`competences.status.${status}`)}
      </Badge>
      <Text
        as="span"
        variant="muted"
        truncate
        className="text-xs"
        title={row.revoker}
      >
        {detail}
      </Text>
    </div>
  );
}
