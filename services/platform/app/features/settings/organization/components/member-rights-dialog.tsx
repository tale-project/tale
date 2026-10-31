'use client';

import { Badge } from '@tale/ui/badge';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { ViewDialog } from '@tale/ui/dialog/view-dialog';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Switch } from '@tale/ui/switch';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { useToast } from '@tale/ui/use-toast';
import { useId, useRef, useState } from 'react';

import { mapCompetenceError } from '@/app/features/settings/governance/competences/competence-errors';
import { capabilityMessageKey } from '@/app/features/settings/governance/competences/competence-labels';
import { GrantCompetenceDialog } from '@/app/features/settings/governance/competences/grant-competence-dialog';
import { useRevokeCompetence } from '@/app/features/settings/governance/hooks/mutations';
import { useMemberRights } from '@/app/features/settings/governance/hooks/queries';
import { readStateOf } from '@/app/lib/backend/read-state';
import { useT } from '@/lib/i18n/client';
import {
  type MemberRight,
  type MemberRightReason,
  PLATFORM_CAPABILITIES,
  type PlatformCapability,
} from '@/lib/shared/competences';

import { useMembers } from '../hooks/queries';
import { useRoleLabel } from './role-badge';

const MODEL_API_STATES = {
  on: 'organization.memberRights.reasons.modelApiOn',
  off: 'organization.memberRights.reasons.modelApiOff',
  unreadable: 'organization.memberRights.reasons.modelApiUnreadable',
} as const;

const SKILL_SHARING_MODES = {
  everyone: 'skillSharing.modes.everyone',
  editors: 'skillSharing.modes.editors',
  admins: 'skillSharing.modes.admins',
} as const;

const ROLE_STANDINGS = {
  admits: 'organization.memberRights.reasons.roleAdmits',
  grant: 'organization.memberRights.reasons.roleGrant',
  refuses: 'organization.memberRights.reasons.roleRefuses',
} as const;

// A grant of the member's own, or of a team an admin added them to.
const GRANT_STATES = {
  grant: {
    active: 'organization.memberRights.reasons.grantActive',
    activeUntil: 'organization.memberRights.reasons.grantActiveUntil',
    expired: 'organization.memberRights.reasons.grantExpired',
  },
  team: {
    active: 'organization.memberRights.reasons.teamGrantActive',
    activeUntil: 'organization.memberRights.reasons.teamGrantActiveUntil',
    expired: 'organization.memberRights.reasons.teamGrantExpired',
  },
} as const;

const LOADING_RIGHTS: readonly MemberRight[] = PLATFORM_CAPABILITIES.map(
  (capability) => ({
    capability,
    held: false,
    grantId: null,
    reasons: [{ kind: 'no-grant' }],
  }),
);

interface MemberRightsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  member: {
    userId: string;
    displayName?: string;
    email?: string;
  };
}

interface RightRowProps {
  right: MemberRight;
  role: string;
  nameOf: (userId: string) => string;
  disabled: boolean;
  onSwitch: (right: MemberRight, granted: boolean) => void;
}

function RightRow({ right, role, nameOf, disabled, onSwitch }: RightRowProps) {
  const { t } = useT('settings');
  const { t: tGovernance } = useT('governance');
  const roleLabel = useRoleLabel();
  const { formatDate } = useFormatDate();
  const id = useId();
  const date = (ms: number) => formatDate(new Date(ms), 'short');

  const say = (reason: MemberRightReason): string => {
    switch (reason.kind) {
      case 'organization':
        return t(MODEL_API_STATES[reason.state]);
      case 'policy':
        return t('organization.memberRights.reasons.skillSharing', {
          mode: tGovernance(SKILL_SHARING_MODES[reason.mode]),
        });
      case 'role':
        return t(ROLE_STANDINGS[reason.standing], { role: roleLabel(role) });
      case 'grant':
      case 'team': {
        const messages = GRANT_STATES[reason.kind];
        const values = {
          name: nameOf(reason.grantedBy),
          // The register calls a team that is gone a deleted team.
          team:
            reason.kind === 'team'
              ? (reason.teamName ?? tGovernance('competences.deletedTeam'))
              : undefined,
          granted: date(reason.grantedAt),
        };
        if (reason.expiresAt === null) return t(messages.active, values);
        const expires = date(reason.expiresAt);
        return t(
          reason.status === 'expired' ? messages.expired : messages.activeUntil,
          { ...values, expires },
        );
      }
      case 'no-grant':
        return t('organization.memberRights.reasons.noGrant');
    }
  };

  return (
    <li className="flex items-start justify-between gap-4 px-4 py-3">
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span
            id={`${id}-label`}
            className="text-foreground text-sm font-medium"
          >
            {tGovernance(
              `competences.capabilities.${capabilityMessageKey(right.capability)}.label`,
            )}
          </span>
          <Badge id={`${id}-held`} variant={right.held ? 'green' : 'slate'} dot>
            {t(
              right.held
                ? 'organization.memberRights.held'
                : 'organization.memberRights.notHeld',
            )}
          </Badge>
        </div>
        <div id={`${id}-reasons`} className="flex flex-col gap-0.5">
          {right.reasons.map((reason) => (
            <Text
              key={
                reason.kind === 'grant' || reason.kind === 'team'
                  ? reason.recordId
                  : reason.kind
              }
              variant="muted"
            >
              {say(reason)}
            </Text>
          ))}
        </div>
      </div>
      {/* On while the member's own grant is live: the switch is that grant
          in the register. A team's grant stays the team's, named among the
          reasons, and the badge says what the member may do either way. */}
      <Switch
        className="mt-0.5 shrink-0"
        checked={right.grantId !== null}
        onCheckedChange={(granted) => onSwitch(right, granted)}
        disabled={disabled}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-held ${id}-reasons`}
      />
    </li>
  );
}

// =============================================================================
// What one member may do on the platform, and why (GOV-R21): each right as
// its door answers, with the reasons it weighs — the role, a grant, the
// organization's switch or policy. A right's switch is its grant in the
// competence register: on grants it, with an expiry if the admin chooses
// one, off revokes it. Owners and admins only, like the read behind it.
// =============================================================================
export function MemberRightsDialog({
  open,
  onOpenChange,
  organizationId,
  member,
}: MemberRightsDialogProps) {
  const { t } = useT('settings');
  const { t: tGovernance } = useT('governance');
  const { t: tCommon } = useT('common');
  const { toast } = useToast();
  const rights = useMemberRights(organizationId, member.userId, {
    enabled: open,
  });
  const read = readStateOf(rights);
  const { members } = useMembers(organizationId, { enabled: open });
  const revokeMutation = useRevokeCompetence();
  const [grantTarget, setGrantTarget] = useState<PlatformCapability | null>(
    null,
  );
  const [grantOpen, setGrantOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<MemberRight | null>(null);
  const [revoking, setRevoking] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  const memberName = member.displayName || member.email || member.userId;
  // Someone missing from a loaded directory has left the organization;
  // without a directory (it failed to load) the id is all there is.
  const nameOf = (userId: string): string => {
    const person = members?.find((entry) => entry.userId === userId);
    if (person !== undefined) {
      return person.displayName || person.email || person.userId;
    }
    return members === undefined ? userId : tCommon('formerMember');
  };
  const rightLabel = (capability: PlatformCapability) =>
    tGovernance(
      `competences.capabilities.${capabilityMessageKey(capability)}.label`,
    );

  const onSwitch = (right: MemberRight, granted: boolean) => {
    if (granted) {
      setGrantTarget(right.capability);
      setGrantOpen(true);
    } else {
      setRevokeTarget(right);
    }
  };

  const handleRevoke = async () => {
    const recordId = revokeTarget?.grantId;
    if (recordId === undefined || recordId === null) return;
    setRevoking(true);
    try {
      await revokeMutation.mutateAsync({ organizationId, recordId });
      // Close once the rights show the revocation, so the switch the focus
      // returns to is already off.
      await rights.refetch();
      toast({
        title: tGovernance('competences.toasts.revoked'),
        variant: 'success',
      });
      setRevokeTarget(null);
    } catch (err) {
      toast({
        title: tGovernance('competences.toasts.revokeFailed'),
        description: mapCompetenceError(err, tGovernance),
        variant: 'destructive',
      });
      // A refusal often means the grant changed meanwhile (revoked or run
      // out elsewhere): read the rights again, and drop the question when
      // there is no live grant left to revoke.
      const refreshed = await rights.refetch();
      const current = refreshed.data?.rights.find(
        (right) => right.capability === revokeTarget?.capability,
      );
      if (refreshed.data !== undefined && current?.grantId !== recordId) {
        setRevokeTarget(null);
      }
    } finally {
      setRevoking(false);
    }
  };

  const title = t('organization.memberRights.title', { name: memberName });

  return (
    <>
      <ViewDialog
        open={open}
        onOpenChange={onOpenChange}
        title={title}
        description={t('organization.memberRights.description')}
        size="lg"
      >
        {(read.unavailable || read.stale) && (
          <CatalogLoadError
            failureKey={read.failureCount}
            isRetrying={read.retrying}
            onRetry={() => void rights.refetch()}
            // A retry that reads the rights takes the notice, and the focus
            // on its button, away: hand the focus to the rights.
            onFocusLost={() => listRef.current?.focus()}
            message={t(
              read.unavailable
                ? 'organization.memberRights.loadFailed'
                : 'organization.memberRights.refreshFailed',
            )}
          />
        )}
        {!read.unavailable && (
          <Skeletonize loading={rights.data === undefined} label={title}>
            <ul
              ref={listRef}
              tabIndex={-1}
              aria-label={title}
              className="border-border divide-border divide-y rounded-lg border"
            >
              {(rights.data?.rights ?? LOADING_RIGHTS).map((right) => (
                <RightRow
                  key={right.capability}
                  right={right}
                  role={rights.data?.role ?? ''}
                  nameOf={nameOf}
                  // A switch acts on an answer: never on the placeholder rows.
                  // It stays enabled while a newer answer is on its way, so
                  // the focus a closing grant or revoke dialog hands back
                  // to it is not lost.
                  disabled={rights.data === undefined || revoking}
                  onSwitch={onSwitch}
                />
              ))}
            </ul>
          </Skeletonize>
        )}
      </ViewDialog>

      {grantTarget !== null && (
        <GrantCompetenceDialog
          // A fresh form for each right: the grant dialog takes its member
          // and right as defaults when it mounts.
          key={grantTarget}
          open={grantOpen}
          onOpenChange={setGrantOpen}
          organizationId={organizationId}
          fixed={{
            userId: member.userId,
            memberName,
            capability: grantTarget,
          }}
        />
      )}

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(next) => {
          if (!next) setRevokeTarget(null);
        }}
        variant="destructive"
        title={tGovernance('competences.revokeDialog.title')}
        description={
          revokeTarget
            ? tGovernance('competences.revokeDialog.description', {
                competence: rightLabel(revokeTarget.capability),
                member: memberName,
              })
            : undefined
        }
        confirmText={tGovernance('competences.revokeDialog.confirm')}
        cancelText={tCommon('actions.cancel')}
        isLoading={revoking}
        onConfirm={() => void handleRevoke()}
      />
    </>
  );
}
