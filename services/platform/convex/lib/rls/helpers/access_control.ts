/**
 * Pure permission lookup for RLS — zero external dependencies.
 *
 * This replicates the role → table → action matrix from auth.ts
 * without pulling in better-auth, so query bundles stay lightweight.
 */

type PlatformTable =
  | 'customAgents'
  | 'documents'
  | 'products'
  | 'customers'
  | 'vendors'
  | 'integrations'
  | 'onedriveSyncConfigs'
  | 'conversations'
  | 'conversationMessages'
  | 'wfDefinitions'
  | 'wfStepDefs'
  | 'wfStepAuditLogs'
  | 'wfExecutions'
  | 'approvals'
  | 'websites'
  | 'workflowProcessingRecords'
  | 'auditLogs';

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
    customAgents: ALL,
    documents: ALL,
    products: ALL,
    customers: ALL,
    vendors: ALL,
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
    auditLogs: ALL,
  },
  developer: {
    customAgents: ALL,
    documents: ALL,
    products: ALL,
    customers: ALL,
    vendors: ALL,
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
    auditLogs: ALL,
  },
  editor: {
    customAgents: ALL,
    documents: ALL,
    products: ALL,
    customers: ALL,
    vendors: ALL,
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
    auditLogs: ALL,
  },
  member: {
    customAgents: READ_ONLY,
    documents: READ_ONLY,
    products: READ_ONLY,
    customers: READ_ONLY,
    vendors: READ_ONLY,
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
    auditLogs: READ_ONLY,
  },
  disabled: {
    customAgents: NONE,
    documents: NONE,
    products: NONE,
    customers: NONE,
    vendors: NONE,
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
    auditLogs: NONE,
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
