/**
 * Pure permission lookup for RLS — zero external dependencies.
 *
 * This replicates the role → table → action matrix from auth.ts
 * without pulling in better-auth, so query bundles stay lightweight.
 */

type PlatformTable =
  | 'documents'
  | 'products'
  | 'projects'
  | 'contacts'
  | 'integrationCredentials'
  | 'integrations'
  | 'onedriveSyncConfigs'
  | 'conversations'
  | 'conversationMessages'
  | 'wfDefinitions' // file-based workflows UI permission subject (relic id — DB-backed workflows removed)
  | 'wfExecutions'
  | 'approvals'
  | 'websites'
  | 'promptTemplates'
  | 'promptCategories'
  | 'auditLogs'
  // Sandbox / artifact tables — added round-2 R2-B8. Previously the
  // `rls_rules.ts` entries for these tables gated on bare org membership
  // and bypassed `authorizeRls`, which meant a `member` (read-only) user
  // could still write to artifacts and trigger billable sandbox runs.
  | 'artifacts'
  | 'artifactRevisions'
  | 'auditLogChainGenesis'
  // Multi-file artifact tables — added audit follow-up F14. Writes go
  // exclusively through internalMutation (handlers/*.ts); reads need
  // an explicit READ_ONLY role-matrix entry so the new rls_rules.ts
  // rules can defense-in-depth via `authorizeRls()` (otherwise the
  // deny-by-default permissions would silently 0-result the canvas).
  | 'artifactFiles'
  | 'artifactRuns'
  | 'artifactRunFiles'
  | 'artifactOutputs';

type PlatformAction = 'read' | 'write';

type PlatformRoleName =
  | 'admin'
  | 'developer'
  | 'editor'
  | 'member'
  | 'disabled';

const ALL: readonly PlatformAction[] = ['read', 'write'];
const READ_ONLY: readonly PlatformAction[] = ['read'];
const WRITE_ONLY: readonly PlatformAction[] = ['write'];
const NONE: readonly PlatformAction[] = [];

const platformPermissions: Record<
  PlatformRoleName,
  Partial<Record<PlatformTable, readonly PlatformAction[]>>
> = {
  admin: {
    documents: ALL,
    products: ALL,
    projects: ALL,
    contacts: ALL,
    integrationCredentials: ALL,
    integrations: ALL,
    onedriveSyncConfigs: ALL,
    conversations: ALL,
    conversationMessages: ALL,
    wfDefinitions: ALL,
    wfExecutions: ALL,
    approvals: ALL,
    websites: ALL,
    promptTemplates: ALL,
    promptCategories: ALL,
    auditLogs: ALL,
    artifacts: ALL,
    artifactRevisions: ALL,
    // Genesis row is an internal sentinel — no client-facing reads/writes.
    auditLogChainGenesis: NONE,
    // Audit table; user-facing access is read-only across all roles.
    // Multi-file artifact tables: writes are internal-only (handlers/*.ts);
    // reads through RLS-wrapped queries get READ_ONLY across all org roles.
    artifactFiles: READ_ONLY,
    artifactRuns: READ_ONLY,
    artifactRunFiles: READ_ONLY,
    artifactOutputs: READ_ONLY,
  },
  developer: {
    documents: ALL,
    products: ALL,
    projects: ALL,
    contacts: ALL,
    integrationCredentials: ALL,
    integrations: ALL,
    onedriveSyncConfigs: ALL,
    conversations: ALL,
    conversationMessages: ALL,
    wfDefinitions: ALL,
    wfExecutions: ALL,
    approvals: ALL,
    websites: ALL,
    promptTemplates: ALL,
    promptCategories: ALL,
    // Audit-log reads are admin-only (#1505); WRITE stays so RLS-wrapped
    // user mutations can insert their own audit rows.
    auditLogs: WRITE_ONLY,
    artifacts: ALL,
    artifactRevisions: ALL,
    auditLogChainGenesis: NONE,
    artifactFiles: READ_ONLY,
    artifactRuns: READ_ONLY,
    artifactRunFiles: READ_ONLY,
    artifactOutputs: READ_ONLY,
  },
  editor: {
    documents: ALL,
    products: ALL,
    projects: ALL,
    contacts: ALL,
    integrationCredentials: READ_ONLY,
    integrations: READ_ONLY,
    onedriveSyncConfigs: READ_ONLY,
    conversations: ALL,
    conversationMessages: ALL,
    wfDefinitions: READ_ONLY,
    wfExecutions: READ_ONLY,
    approvals: ALL,
    websites: ALL,
    promptTemplates: ALL,
    promptCategories: ALL,
    // Audit-log reads are admin-only (#1505); WRITE stays so RLS-wrapped
    // user mutations can insert their own audit rows.
    auditLogs: WRITE_ONLY,
    artifacts: ALL,
    artifactRevisions: ALL,
    auditLogChainGenesis: NONE,
    artifactFiles: READ_ONLY,
    artifactRuns: READ_ONLY,
    artifactRunFiles: READ_ONLY,
    artifactOutputs: READ_ONLY,
  },
  member: {
    documents: READ_ONLY,
    products: READ_ONLY,
    projects: READ_ONLY,
    contacts: READ_ONLY,
    integrationCredentials: READ_ONLY,
    integrations: READ_ONLY,
    onedriveSyncConfigs: READ_ONLY,
    conversations: READ_ONLY,
    conversationMessages: READ_ONLY,
    wfDefinitions: READ_ONLY,
    wfExecutions: READ_ONLY,
    approvals: READ_ONLY,
    websites: READ_ONLY,
    promptTemplates: ALL,
    promptCategories: ALL,
    // Audit-log reads are admin-only (#1505); member audit rows are written
    // through internal mutations that bypass RLS (see prompts/mutations.ts).
    auditLogs: NONE,
    // Members can READ artifacts (so the chat surface keeps working in
    // shared threads) but NOT write — artifact_create / file_* /
    // artifact_run all trigger billable sandbox executions. Aligns with
    // the `documents` table's own member-as-read-only contract.
    artifacts: READ_ONLY,
    artifactRevisions: READ_ONLY,
    auditLogChainGenesis: NONE,
    artifactFiles: READ_ONLY,
    artifactRuns: READ_ONLY,
    artifactRunFiles: READ_ONLY,
    artifactOutputs: READ_ONLY,
  },
  disabled: {
    documents: NONE,
    products: NONE,
    projects: NONE,
    contacts: NONE,
    integrationCredentials: NONE,
    integrations: NONE,
    onedriveSyncConfigs: NONE,
    conversations: NONE,
    conversationMessages: NONE,
    wfDefinitions: NONE,
    wfExecutions: NONE,
    approvals: NONE,
    websites: NONE,
    promptTemplates: NONE,
    promptCategories: NONE,
    auditLogs: NONE,
    artifacts: NONE,
    artifactRevisions: NONE,
    auditLogChainGenesis: NONE,
    artifactFiles: NONE,
    artifactRuns: NONE,
    artifactRunFiles: NONE,
    artifactOutputs: NONE,
  },
};

function isValidRole(value: string): value is PlatformRoleName {
  return (
    value === 'admin' ||
    value === 'developer' ||
    value === 'editor' ||
    value === 'member' ||
    value === 'disabled'
  );
}

export function authorizeRls(
  role: string | undefined,
  table: PlatformTable,
  action: PlatformAction,
): boolean {
  const normalized = (role ?? 'member').toLowerCase();
  const key: PlatformRoleName =
    normalized === 'owner'
      ? 'admin'
      : isValidRole(normalized)
        ? normalized
        : 'member';
  const perms = platformPermissions[key][table];
  return perms !== undefined && perms.includes(action);
}
