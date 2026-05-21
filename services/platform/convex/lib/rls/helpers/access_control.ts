/**
 * Pure permission lookup for RLS — zero external dependencies.
 *
 * This replicates the role → table → action matrix from auth.ts
 * without pulling in better-auth, so query bundles stay lightweight.
 */

type PlatformTable =
  | 'agentBindings'
  | 'documents'
  | 'products'
  | 'customers'
  | 'vendors'
  | 'integrationCredentials'
  | 'integrations'
  | 'onedriveSyncConfigs'
  | 'conversations'
  | 'conversationMessages'
  | 'wfDefinitions' // @deprecated — DB table deprecated; kept as permission subject for legacy data access
  | 'wfStepDefs' // @deprecated — DB table deprecated; kept as permission subject for legacy data access
  | 'wfStepAuditLogs' // @deprecated — DB table deprecated; kept as permission subject for legacy data access
  | 'wfExecutions'
  | 'approvals'
  | 'websites'
  | 'workflowProcessingRecords'
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
  | 'sandboxExecutions';

type PlatformAction = 'read' | 'write';

type PlatformRoleName =
  | 'admin'
  | 'developer'
  | 'editor'
  | 'member'
  | 'disabled';

const ALL: readonly PlatformAction[] = ['read', 'write'];
const READ_ONLY: readonly PlatformAction[] = ['read'];
const NONE: readonly PlatformAction[] = [];

const platformPermissions: Record<
  PlatformRoleName,
  Partial<Record<PlatformTable, readonly PlatformAction[]>>
> = {
  admin: {
    agentBindings: ALL,
    documents: ALL,
    products: ALL,
    customers: ALL,
    vendors: ALL,
    integrationCredentials: ALL,
    integrations: ALL,
    onedriveSyncConfigs: ALL,
    conversations: ALL,
    conversationMessages: ALL,
    wfDefinitions: ALL,
    wfStepDefs: ALL,
    wfStepAuditLogs: ALL,
    wfExecutions: ALL,
    workflowProcessingRecords: ALL,
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
    sandboxExecutions: READ_ONLY,
  },
  developer: {
    agentBindings: ALL,
    documents: ALL,
    products: ALL,
    customers: ALL,
    vendors: ALL,
    integrationCredentials: ALL,
    integrations: ALL,
    onedriveSyncConfigs: ALL,
    conversations: ALL,
    conversationMessages: ALL,
    wfDefinitions: ALL,
    wfStepDefs: ALL,
    wfStepAuditLogs: ALL,
    wfExecutions: ALL,
    workflowProcessingRecords: ALL,
    approvals: ALL,
    websites: ALL,
    promptTemplates: ALL,
    promptCategories: ALL,
    auditLogs: ALL,
    artifacts: ALL,
    artifactRevisions: ALL,
    auditLogChainGenesis: NONE,
    sandboxExecutions: READ_ONLY,
  },
  editor: {
    agentBindings: ALL,
    documents: ALL,
    products: ALL,
    customers: ALL,
    vendors: ALL,
    integrationCredentials: READ_ONLY,
    integrations: READ_ONLY,
    onedriveSyncConfigs: READ_ONLY,
    conversations: ALL,
    conversationMessages: ALL,
    wfDefinitions: READ_ONLY,
    wfStepDefs: READ_ONLY,
    wfStepAuditLogs: READ_ONLY,
    wfExecutions: READ_ONLY,
    workflowProcessingRecords: READ_ONLY,
    approvals: ALL,
    websites: ALL,
    promptTemplates: ALL,
    promptCategories: ALL,
    auditLogs: ALL,
    artifacts: ALL,
    artifactRevisions: ALL,
    auditLogChainGenesis: NONE,
    sandboxExecutions: READ_ONLY,
  },
  member: {
    agentBindings: READ_ONLY,
    documents: READ_ONLY,
    products: READ_ONLY,
    customers: READ_ONLY,
    vendors: READ_ONLY,
    integrationCredentials: READ_ONLY,
    integrations: READ_ONLY,
    onedriveSyncConfigs: READ_ONLY,
    conversations: READ_ONLY,
    conversationMessages: READ_ONLY,
    wfDefinitions: READ_ONLY,
    wfStepDefs: READ_ONLY,
    wfStepAuditLogs: READ_ONLY,
    wfExecutions: READ_ONLY,
    workflowProcessingRecords: READ_ONLY,
    approvals: READ_ONLY,
    websites: READ_ONLY,
    promptTemplates: ALL,
    promptCategories: ALL,
    auditLogs: READ_ONLY,
    // Members can READ artifacts (so the chat surface keeps working in
    // shared threads) but NOT write — artifact_create / artifact_edit /
    // artifact_run all trigger billable sandbox executions. Aligns with
    // the `documents` table's own member-as-read-only contract.
    artifacts: READ_ONLY,
    artifactRevisions: READ_ONLY,
    auditLogChainGenesis: NONE,
    sandboxExecutions: READ_ONLY,
  },
  disabled: {
    agentBindings: NONE,
    documents: NONE,
    products: NONE,
    customers: NONE,
    vendors: NONE,
    integrationCredentials: NONE,
    integrations: NONE,
    onedriveSyncConfigs: NONE,
    conversations: NONE,
    conversationMessages: NONE,
    wfDefinitions: NONE,
    wfStepDefs: NONE,
    wfStepAuditLogs: NONE,
    wfExecutions: NONE,
    workflowProcessingRecords: NONE,
    approvals: NONE,
    websites: NONE,
    promptTemplates: NONE,
    promptCategories: NONE,
    auditLogs: NONE,
    artifacts: NONE,
    artifactRevisions: NONE,
    auditLogChainGenesis: NONE,
    sandboxExecutions: NONE,
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
