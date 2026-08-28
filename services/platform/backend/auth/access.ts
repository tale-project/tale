import { createAccessControl } from 'better-auth/plugins/access';
import {
  adminAc,
  defaultStatements,
  ownerAc,
} from 'better-auth/plugins/organization/access';

/**
 * Better Auth access control — the org-role permission matrix, ported
 * verbatim from 0.4 `convex/auth.ts`. Table-keyed statements are shared by
 * the organization plugin (invitation/role management) and `authorizeRls`
 * (the per-request read/write gate the ported RLS layer consults).
 */

const platformResourceStatements = {
  agents: ['read', 'write'],
  documents: ['read', 'write'],
  products: ['read', 'write'],
  projects: ['read', 'write'],
  contacts: ['read', 'write'],
  connectors: ['read', 'write'],
  onedriveSyncConfigs: ['read', 'write'],
  googleDriveSyncConfigs: ['read', 'write'],
  conversations: ['read', 'write'],
  conversationMessages: ['read', 'write'],
  wfDefinitions: ['read', 'write'], // file-based workflows UI permission subject (relic id — DB-backed workflows removed)
  wfExecutions: ['read', 'write'],
  approvals: ['read', 'write'],
  websites: ['read', 'write'],
  auditLogs: ['read', 'write'],
  governancePolicies: ['read', 'write'],
  messageFeedback: ['read', 'write'],
} as const;

const platformStatements = {
  ...defaultStatements,
  ...platformResourceStatements,
} as const;

export const ac = createAccessControl(platformStatements);

export type PlatformTable = keyof typeof platformResourceStatements;
export type PlatformAction = 'read' | 'write';

/** Grant `actions` on every platform table (role rows are uniform in 0.4). */
function uniformGrants(
  actions: PlatformAction[],
): Record<PlatformTable, PlatformAction[]> {
  return {
    agents: [...actions],
    documents: [...actions],
    products: [...actions],
    projects: [...actions],
    contacts: [...actions],
    connectors: [...actions],
    onedriveSyncConfigs: [...actions],
    googleDriveSyncConfigs: [...actions],
    conversations: [...actions],
    conversationMessages: [...actions],
    wfDefinitions: [...actions],
    wfExecutions: [...actions],
    approvals: [...actions],
    websites: [...actions],
    auditLogs: [...actions],
    governancePolicies: [...actions],
    messageFeedback: [...actions],
  };
}

const owner = ac.newRole({
  ...ownerAc.statements,
  ...uniformGrants(['read', 'write']),
});

const admin = ac.newRole({
  ...adminAc.statements,
  ...uniformGrants(['read', 'write']),
});

const developer = ac.newRole(uniformGrants(['read', 'write']));

// Editor: writes content-shaped resources; connector/provider/sync/workflow
// surfaces are read-only; no settings access (frontend menu restricted).
const editor = ac.newRole({
  ...uniformGrants(['read', 'write']),
  connectors: ['read'],
  onedriveSyncConfigs: ['read'],
  googleDriveSyncConfigs: ['read'],
  wfDefinitions: ['read'],
  wfExecutions: ['read'],
  governancePolicies: ['read'],
});

const member = ac.newRole({
  ...uniformGrants(['read']),
  messageFeedback: ['read', 'write'],
});

const disabled = ac.newRole(uniformGrants([]));

export const platformRoles = {
  owner,
  admin,
  developer,
  editor,
  member,
  disabled,
} as const;
export type PlatformRoleName = keyof typeof platformRoles;

/** Role map handed to the organization plugin. */
export const orgRoles = platformRoles;

/** Table-level read/write gate; unknown roles degrade to `member`. */
export function authorizeRls(
  role: string | undefined,
  table: PlatformTable,
  action: PlatformAction,
): boolean {
  const normalized = (role ?? 'member').toLowerCase();
  const key: PlatformRoleName =
    normalized === 'owner' ||
    normalized === 'admin' ||
    normalized === 'developer' ||
    normalized === 'editor' ||
    normalized === 'disabled'
      ? normalized
      : 'member';
  const r = platformRoles[key];
  const req = { [table]: [action] } as Record<string, string[]>;
  const res = (
    r as {
      authorize: (
        req: Record<string, string[]>,
      ) => { success?: boolean } | undefined;
    }
  ).authorize(req);
  return !!res?.success;
}
