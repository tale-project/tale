'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { DataTable } from '@tale/ui/data-table/data-table';
import type { FilterConfig } from '@tale/ui/data-table/data-table-filters';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { IconButton } from '@tale/ui/icon-button';
import { HStack } from '@tale/ui/layout';
import { TableDateCell } from '@tale/ui/table-date-cell';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { useToast } from '@tale/ui/use-toast';
import type { ColumnDef } from '@tanstack/react-table';
import { BadgeCheck, Ban, Pencil, Plus } from 'lucide-react';
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
import { EditCompetenceDialog } from './edit-competence-dialog';
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

/** Whom a grant names: a member, or a team whose members hold it. */
interface Holder extends Person {
  team: boolean;
}

interface CompetenceRow {
  record: CompetenceRecordWire;
  status: CompetenceRecordStatus;
  holder: Holder;
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
 * Settings → Governance → Rights and qualifications: the organization's
 * competence register. Admins grant a member a right (one platform capability,
 * a narrow right without an admin seat) or a qualification a review policy asks
 * for, or grant a team a right its members hold, change a live grant's end
 * date and evidence, and revoke it; revoked and expired grants stay listed as
 * the audit trail.
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
  const [editTarget, setEditTarget] = useState<CompetenceRow | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<CompetenceRow | null>(null);
  const [revoking, setRevoking] = useState(false);
  // A revoked row can leave the filtered list; focus then returns to the
  // section around the table.
  const tableRegionRef = useRef<HTMLElement>(null);

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
        name: members === undefined ? userId : tCommon('formerMember'),
        email: null,
      };
    // A team grant names the team; once the team is deleted its revoked
    // grants stay listed under "Deleted team".
    const holderOf = (record: CompetenceRecordWire): Holder =>
      record.userId === null
        ? {
            name: record.teamName ?? t('competences.deletedTeam'),
            email: null,
            team: true,
          }
        : { ...personOf(record.userId), team: false };
    const records = competences.data ?? [];
    // The register revokes on its own (`revokedBy` = `system`) when a new
    // grant replaces one that had expired — the new one is granted to the
    // same holder in the same instant — when the member leaves the
    // organization, and when the team is deleted.
    const holderKey = (record: CompetenceRecordWire, at: number | null) =>
      [record.userId, record.teamId, record.competence, at].join('\u0000');
    const grantInstants = new Set(
      records.map((record) => holderKey(record, record.grantedAt)),
    );
    const systemRevocation = (record: CompetenceRecordWire): string =>
      grantInstants.has(holderKey(record, record.revokedAt))
        ? t('competences.revokedBySystem')
        : record.userId === null
          ? t('competences.revokedWithTeam')
          : t('competences.revokedWithMember');
    return records.map((record) => ({
      record,
      status: competenceRecordStatus(record, now),
      holder: holderOf(record),
      grantor: personOf(record.grantedBy),
      capabilityLabel: isPlatformCapability(record.competence)
        ? t(
            `competences.capabilities.${capabilityMessageKey(record.competence)}.label`,
          )
        : null,
      // An admin revoked it, or the register did on its own.
      revoker:
        record.revokedBy === null
          ? undefined
          : record.revokedBy === 'system'
            ? systemRevocation(record)
            : t('competences.revokedBy', {
                name: personOf(record.revokedBy).name,
              }),
    }));
  }, [competences.data, members, people, t, tCommon]);

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
      // A refusal often means someone else changed the grant meanwhile
      // (already revoked, gone): refresh, and drop the dialog when there is
      // no longer anything live to revoke.
      const refreshed = await competences.refetch();
      const current = refreshed.data?.find(
        (record) => record.id === revokeTarget.record.id,
      );
      if (
        refreshed.data !== undefined &&
        (current === undefined ||
          competenceRecordStatus(current, Date.now()) !== 'active')
      ) {
        setRevokeTarget(null);
      }
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
            <HStack gap={2} align="center" className="min-w-0">
              <Text as="span" truncate title={row.original.holder.name}>
                {row.original.holder.name}
              </Text>
              {/* Its members hold the grant while they are in the team. */}
              {row.original.holder.team ? (
                <Badge variant="outline" className="shrink-0">
                  {t('competences.teamBadge')}
                </Badge>
              ) : null}
            </HStack>
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
        // Sized for the edit icon beside the widest Revoke label across
        // locales ("Widerrufen", ~154px rendered with its icon and the cell
        // padding).
        size: 200,
        cell: ({ row }) =>
          row.original.status === 'active' ? (
            <div className="flex items-center justify-end gap-2">
              {/* The aria-label names the grant, and shows as the tooltip. */}
              <IconButton
                icon={Pencil}
                aria-label={t('competences.actions.editFor', {
                  competence: competenceName(row.original),
                  member: row.original.holder.name,
                })}
                onClick={() => setEditTarget(row.original)}
              />
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
            </div>
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
        {/* The revoke dialog returns focus to the named section once the
            row has left the list: a region by its heading, since ARIA lets
            no plain div carry a name. */}
        <SettingsSection
          ref={tableRegionRef}
          title={t('competences.title')}
          description={t('competences.description')}
          tabIndex={-1}
          className="min-h-0 flex-1 outline-none"
        >
          <div className="flex min-h-0 flex-1 flex-col">
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

      {/* Mounted per grant, so the form starts from that grant's values. */}
      {editTarget !== null && (
        <EditCompetenceDialog
          key={editTarget.record.id}
          open
          onOpenChange={(open) => {
            if (!open) setEditTarget(null);
          }}
          organizationId={organizationId}
          record={editTarget.record}
          competenceName={competenceName(editTarget)}
          holder={editTarget.holder}
          onRefused={() => void competences.refetch()}
        />
      )}

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
        variant="destructive"
        title={t('competences.revokeDialog.title')}
        description={
          revokeTarget
            ? revokeTarget.holder.team
              ? t('competences.revokeDialog.descriptionTeam', {
                  competence: competenceName(revokeTarget),
                  team: revokeTarget.holder.name,
                })
              : t('competences.revokeDialog.description', {
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
