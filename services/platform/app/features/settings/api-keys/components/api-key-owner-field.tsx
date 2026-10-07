'use client';

import { SearchableSelect } from '@tale/ui/searchable-select';
import { Select } from '@tale/ui/select';
import { useMemo } from 'react';

import { useProjects } from '@/app/features/projects/hooks/queries';
import { useOrgMembersForPicker } from '@/app/features/settings/governance/hooks/queries';
import { useOrgTeams } from '@/app/features/settings/teams/hooks/queries';
import { useT } from '@/lib/i18n/client';
import { roleRank } from '@/lib/shared/role-rank';

import type { ApiKeyRole } from '../types';

/** Whose key a new one is. Owners and Admins choose; anyone else makes
 * their own. */
export type ApiKeyOwnerChoice =
  | 'self'
  | 'member'
  | 'team'
  | 'project'
  | 'organization';

const OWNER_CHOICES: readonly ApiKeyOwnerChoice[] = [
  'self',
  'member',
  'team',
  'project',
  'organization',
];

const OWNER_LABEL_KEYS: Record<ApiKeyOwnerChoice, string> = {
  self: 'apiKeys.form.ownerOptions.self',
  member: 'apiKeys.form.ownerOptions.member',
  team: 'apiKeys.form.ownerOptions.team',
  project: 'apiKeys.form.ownerOptions.project',
  organization: 'apiKeys.form.ownerOptions.organization',
};

/** What the dialog says the key will be, per owner. */
const OWNER_HINT_KEYS: Record<ApiKeyOwnerChoice, string> = {
  self: 'apiKeys.form.scopeHint',
  member: 'apiKeys.form.ownerHints.member',
  team: 'apiKeys.form.ownerHints.team',
  project: 'apiKeys.form.ownerHints.project',
  organization: 'apiKeys.form.ownerHints.organization',
};

/** A team's or a project's key sees what a member of a team sees; the
 * organization's key may also be an admin. */
const SCOPED_ROLES: readonly ApiKeyRole[] = ['member', 'editor', 'developer'];
const ORGANIZATION_ROLES: readonly ApiKeyRole[] = [
  'member',
  'editor',
  'developer',
  'admin',
];

function isApiKeyOwnerChoice(value: string): value is ApiKeyOwnerChoice {
  return (OWNER_CHOICES as readonly string[]).includes(value);
}

function isApiKeyRole(value: string): value is ApiKeyRole {
  return (ORGANIZATION_ROLES as readonly string[]).includes(value);
}

/** The roles a key for `choice` may act with: never above the maker's. */
export function rolesFor(
  choice: ApiKeyOwnerChoice,
  viewerRole: string | undefined,
): ApiKeyRole[] {
  const roles = choice === 'organization' ? ORGANIZATION_ROLES : SCOPED_ROLES;
  return roles.filter((role) => roleRank(role) <= roleRank(viewerRole ?? ''));
}

interface ApiKeyOwnerFieldProps {
  organizationId: string;
  viewerUserId: string | undefined;
  viewerRole: string | undefined;
  choice: ApiKeyOwnerChoice;
  onChoiceChange: (choice: ApiKeyOwnerChoice) => void;
  memberId: string;
  /** The member picked, with the name the success view shows. */
  onMemberChange: (userId: string, name: string) => void;
  teamId: string;
  onTeamChange: (teamId: string) => void;
  projectId: string;
  onProjectChange: (projectId: string) => void;
  role: ApiKeyRole;
  onRoleChange: (role: ApiKeyRole) => void;
}

/**
 * Whom a new key belongs to: the maker, another member (it acts as them, in
 * this organization only), or a team, a project or the organization — a key
 * that is not a person and acts with the role chosen here.
 */
export function ApiKeyOwnerField(props: ApiKeyOwnerFieldProps) {
  const { t } = useT('settings');
  const { t: tRoles } = useT('roles');
  const { choice } = props;

  const ownerOptions = useMemo(
    () =>
      OWNER_CHOICES.map((value) => ({
        value,
        label: t(OWNER_LABEL_KEYS[value]),
      })),
    [t],
  );
  const roleOptions = useMemo(
    () =>
      rolesFor(choice, props.viewerRole).map((value) => ({
        value,
        label: tRoles(value),
      })),
    [choice, props.viewerRole, tRoles],
  );

  return (
    <>
      <Select
        id="api-key-owner"
        label={t('apiKeys.form.owner')}
        value={choice}
        onValueChange={(value) => {
          if (isApiKeyOwnerChoice(value)) props.onChoiceChange(value);
        }}
        options={ownerOptions}
        hint={t(OWNER_HINT_KEYS[choice])}
      />
      {choice === 'member' && (
        <MemberPicker
          organizationId={props.organizationId}
          viewerUserId={props.viewerUserId}
          viewerRole={props.viewerRole}
          value={props.memberId}
          onChange={props.onMemberChange}
        />
      )}
      {choice === 'team' && (
        <TeamPicker value={props.teamId} onChange={props.onTeamChange} />
      )}
      {choice === 'project' && (
        <ProjectPicker
          organizationId={props.organizationId}
          value={props.projectId}
          onChange={props.onProjectChange}
        />
      )}
      {(choice === 'team' ||
        choice === 'project' ||
        choice === 'organization') && (
        <Select
          id="api-key-role"
          label={t('apiKeys.form.role')}
          value={props.role}
          onValueChange={(value) => {
            if (isApiKeyRole(value)) props.onRoleChange(value);
          }}
          options={roleOptions}
          hint={t('apiKeys.form.roleHint')}
        />
      )}
    </>
  );
}

/** The members a key may be made for: active, someone else, and below the
 * maker's role — making a key that acts as someone takes more authority
 * than they hold. */
function MemberPicker({
  organizationId,
  viewerUserId,
  viewerRole,
  value,
  onChange,
}: {
  organizationId: string;
  viewerUserId: string | undefined;
  viewerRole: string | undefined;
  value: string;
  onChange: (userId: string, name: string) => void;
}) {
  const { t } = useT('settings');
  const { t: tRoles } = useT('roles');
  const { data: members } = useOrgMembersForPicker(organizationId);
  const options = useMemo(
    () =>
      (members ?? [])
        .filter(
          (member) =>
            member.userId !== viewerUserId &&
            roleRank(member.role) < roleRank(viewerRole ?? ''),
        )
        .map((member) => ({
          value: member.userId,
          label: member.displayName,
          description: `${member.email} · ${tRoles(member.role.toLowerCase())}`,
        })),
    [members, viewerUserId, viewerRole, tRoles],
  );
  return (
    <SearchableSelect
      id="api-key-member"
      label={t('apiKeys.form.member')}
      placeholder={t('apiKeys.form.memberPlaceholder')}
      searchPlaceholder={t('apiKeys.form.memberSearch')}
      emptyText={t('apiKeys.form.memberEmpty')}
      required
      value={value || null}
      onValueChange={(userId) =>
        onChange(
          userId,
          options.find((option) => option.value === userId)?.label ?? userId,
        )
      }
      options={options}
    />
  );
}

function TeamPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (teamId: string) => void;
}) {
  const { t } = useT('settings');
  const { teams } = useOrgTeams();
  const options = useMemo(
    () => (teams ?? []).map((team) => ({ value: team.id, label: team.name })),
    [teams],
  );
  return (
    <SearchableSelect
      id="api-key-team"
      label={t('apiKeys.form.team')}
      placeholder={t('apiKeys.form.teamPlaceholder')}
      searchPlaceholder={t('apiKeys.form.teamSearch')}
      emptyText={t('apiKeys.form.teamEmpty')}
      required
      value={value || null}
      onValueChange={onChange}
      options={options}
    />
  );
}

function ProjectPicker({
  organizationId,
  value,
  onChange,
}: {
  organizationId: string;
  value: string;
  onChange: (projectId: string) => void;
}) {
  const { t } = useT('settings');
  const { projects } = useProjects(organizationId);
  const options = useMemo(
    () =>
      projects
        // An archived project takes no new keys.
        .filter((project) => !project.archivedAt)
        .map((project) => ({ value: project._id, label: project.name })),
    [projects],
  );
  return (
    <SearchableSelect
      id="api-key-project"
      label={t('apiKeys.form.project')}
      placeholder={t('apiKeys.form.projectPlaceholder')}
      searchPlaceholder={t('apiKeys.form.projectSearch')}
      emptyText={t('apiKeys.form.projectEmpty')}
      required
      value={value || null}
      onValueChange={onChange}
      options={options}
    />
  );
}
