/**
 * Root Convex schema — the single registry of the platform's tables and fields.
 *
 * TENANT ISOLATION (see AGENTS.md → Non-negotiable boundaries): any table or
 * field that holds org-owned data MUST be scoped and queried per organization
 * (an `organizationId` column + a `by_organizationId`-style index). Nothing that
 * belongs to one org may be shared across orgs — a new cross-org shared surface
 * is a defect. Per-org knowledge/RAG/crawler data lives OUTSIDE Convex and is
 * routed through `getKnowledgePoolForOrg(orgSlug)`.
 *
 * The two tables imported from `./legacy/schema` are deferred drops from the
 * retired AI backend — forever empty on 0.4+ deployments (the 0.4 baseline
 * reset removed the upgrade path), kept declared only because live schemas
 * still reference their ids. See legacy/schema.ts for the removal contract.
 */

import { defineSchema } from 'convex/server';

import { approvalsTable } from './approvals/schema';
import {
  auditIntegrityProgressTable,
  auditLogChainGenesisTable,
  auditLogsTable,
} from './audit_logs/schema';
import {
  workflowDeploymentsTable,
  workflowRunsTable,
  workflowTriggersTable,
  workflowsTable,
} from './automations/schema';
import { browserSessionsTable } from './browser_sessions/schema';
import {
  generationsTable,
  memoriesTable,
  messagesTable,
  threadsTable,
} from './chat/schema';
import { chatFilterEventsTable } from './chat_filter_events/schema';
import {
  notificationPreferencesTable,
  taskSubscriptionsTable,
  userNotificationsTable,
} from './collab/schema';
import { contactsTable } from './contacts/schema';
import { backendControlTable } from './control/schema';
import {
  conversationsTable,
  conversationMessagesTable,
} from './conversations/schema';
import { threadMetadataTable } from './discussions/schema';
import { documentsTable } from './documents/schema';
import {
  ssoConnectionsTable,
  ssoProvisioningLinksTable,
} from './enterprise_sso/schema';
import { messageFeedbackTable } from './feedback/schema';
import { fileMetadataTable } from './file_metadata/schema';
import { foldersTable } from './folders/schema';
import {
  activeErasureClaimsTable,
  activeLegalHoldClaimsTable,
  auditLogCheckpointsTable,
  dsarPolicyPendingChangesTable,
  gdprErasureRequestsTable,
  governanceSecretsTable,
  legalHoldReleaseRequestsTable,
  legalHoldsTable,
  legalMattersTable,
  policyAcknowledgementsTable,
  retentionAppliedBoundsTable,
  retentionPolicyPendingChangesTable,
  retentionRunsTable,
  usageLedgerTable,
} from './governance/schema';
import {
  integrationOauthStatesTable,
  slackTeamRoutesTable,
} from './http_integrations/schema';
import { externalIdentitiesTable } from './identities/external_identities_schema';
import { integrationCredentialsTable } from './integration_credentials/schema';
import { knowledgeEntriesTable } from './knowledge_entries/schema';
import { taskAgentRunsTable, wfExecutionsTable } from './legacy/schema';
import { configCacheTable } from './lib/config_cache/schema';
import {
  loginAttemptsTable,
  loginBlockCountersTable,
} from './login_attempts/schema';
import {
  memberMirrorTable,
  memberMirrorReconcileCursorTable,
  teamMemberMirrorTable,
} from './members/schema';
import {
  migrationLedgerTable,
  migrationSnapshotsTable,
} from './migrations/framework/schema';
import { notificationsTable } from './notifications/schema';
import { objectStorageBackfillRunsTable } from './object_storage/schema';
import { onedriveSyncConfigsTable } from './onedrive/schema';
import { productsTable } from './products/schema';
import { projectsTable } from './projects/schema';
import {
  agentSecretAccessTable,
  projectSecretsTable,
} from './projects/secrets/schema';
import {
  promptCategoriesTable,
  promptDefaultProvisionsTable,
  promptTemplatesTable,
} from './prompts/schema';
import { providerCredentialsTable } from './provider_credentials/schema';
import {
  sandboxAdmissionTicketsTable,
  sandboxAgentCheckpointsTable,
  sandboxCredentialAccessTable,
  sandboxSessionOpsTable,
  sandboxSessionsTable,
  sandboxSessionTokensTable,
  sandboxIntegrationCallsTable,
  sandboxToolCallsTable,
  sandboxUserEnvTable,
} from './sandbox/sessions_schema';
import {
  supportCaseActivityTable,
  supportCaseCommentsTable,
  supportCasesTable,
} from './support_cases/schema';
import {
  boardViewsTable,
  taskActivityTable,
  taskDependenciesTable,
  taskDiscussionMessageMetaTable,
  tasksTable,
} from './tasks/schema';
import { twoFactorAttemptsTable } from './two_factor/schema';
import { userPreferencesTable } from './user_preferences/schema';
import {
  userNotificationStateTable,
  userPasswordMetadataTable,
} from './users/schema';
import { videoLinkJobsTable } from './video_links/schema';
import { webdavAppPasswordsTable, webdavLocksTable } from './webdav/schema';
import { websitesTable } from './websites/schema';

export default defineSchema({
  // The automation store: immutable workflow versions, the single deployed
  // version per automation, what starts a run, and the durable run log whose
  // per-node `checkpoints` let an interrupted run resume instead of repeating
  // side effects. Tenant isolation: every row carries `organizationId` and
  // every read goes through a `by_org…` index. See `automations/schema.ts`.
  workflows: workflowsTable,
  workflowDeployments: workflowDeploymentsTable,
  workflowTriggers: workflowTriggersTable,
  workflowRuns: workflowRunsTable,
  // Chat storage. `generations` is split out because it is the only hot-written
  // row during a turn — keeping it out of `threads` means a streaming turn does
  // not rewrite a row every thread list reads. `memories` are pending until a
  // user approves them. See `chat/schema.ts`.
  threads: threadsTable,
  messages: messagesTable,
  generations: generationsTable,
  memories: memoriesTable,
  approvals: approvalsTable,
  auditLogs: auditLogsTable,
  auditLogChainGenesis: auditLogChainGenesisTable,
  auditIntegrityProgress: auditIntegrityProgressTable,
  // Generic file→cache mirror for all `v8-sync` config domains (governance
  // today). Source of truth is the per-org JSON files under
  // `$TALE_CONFIG_DIR/<org>/governance/`; this table is re-derivable. See
  // `lib/config_cache/schema.ts`.
  configCache: configCacheTable,
  // Backend-wide control flags (deploy drain). Singleton row; re-derivable /
  // transient. See `control/schema.ts`.
  backendControl: backendControlTable,
  // Versioned data-migration framework. `migrationLedger` records which
  // migrations have applied (and their resume cursors); `migrationSnapshots`
  // holds pre-`up` backups so destructive migrations can be rolled back. See
  // `migrations/framework/`.
  migrationLedger: migrationLedgerTable,
  migrationSnapshots: migrationSnapshotsTable,
  governanceSecrets: governanceSecretsTable,
  legalHolds: legalHoldsTable,
  activeLegalHoldClaims: activeLegalHoldClaimsTable,
  legalMatters: legalMattersTable,
  legalHoldReleaseRequests: legalHoldReleaseRequestsTable,
  auditLogCheckpoints: auditLogCheckpointsTable,
  retentionRuns: retentionRunsTable,
  retentionPolicyPendingChanges: retentionPolicyPendingChangesTable,
  dsarPolicyPendingChanges: dsarPolicyPendingChangesTable,
  retentionAppliedBounds: retentionAppliedBoundsTable,
  gdprErasureRequests: gdprErasureRequestsTable,
  activeErasureClaims: activeErasureClaimsTable,
  policyAcknowledgements: policyAcknowledgementsTable,
  chatFilterEvents: chatFilterEventsTable,
  usageLedger: usageLedgerTable,
  promptTemplates: promptTemplatesTable,
  promptCategories: promptCategoriesTable,
  promptDefaultProvisions: promptDefaultProvisionsTable,
  messageFeedback: messageFeedbackTable,
  // App-native cache of Better Auth `member` rows for the RLS hot path
  // (getUserOrganizations / isOrgMember). Performance optimization only —
  // never the authoritative gate. See `members/schema.ts`.
  memberMirror: memberMirrorTable,
  memberMirrorReconcileCursor: memberMirrorReconcileCursorTable,
  // Local mirror of Better Auth's `teamMember` table — the team-level
  // counterpart of memberMirror, so getUserTeamIds (the other half of the RLS
  // prime) also reads locally instead of cross-component. See members/schema.ts.
  teamMemberMirror: teamMemberMirrorTable,
  conversationMessages: conversationMessagesTable,
  conversations: conversationsTable,
  contacts: contactsTable,
  documents: documentsTable,
  fileMetadata: fileMetadataTable,
  folders: foldersTable,
  // Integration credentials (rewrite): org-scoped, MULTIPLE per shipped
  // connector, every secret inside one `encryptedData` envelope via
  // lib/secret_box. Tenant isolation: every read/write goes through the
  // `by_org` / `by_org_connector` indexes; nothing in this table is shared
  // across organizations. See `integration_credentials/schema.ts`.
  integrationCredentials: integrationCredentialsTable,
  // Pending OAuth2 authorizations — one short-lived row per consent redirect,
  // holding the org/user/connector the callback is allowed to act for plus the
  // PKCE verifier. Consumed (deleted) on callback, so it is single-use by
  // construction; expired rows are swept when the next one is minted. See
  // `http_integrations/schema.ts`.
  integrationOauthStates: integrationOauthStatesTable,
  // Inbound Slack routing: `team_id` → the organization that installed the app.
  // Tenant isolation: a workspace maps to exactly one organization, an unmapped
  // workspace is refused, and resolution reads only the `by_team` index — no
  // event is ever fanned out across orgs. See `http_integrations/schema.ts`.
  slackTeamRoutes: slackTeamRoutesTable,
  externalIdentities: externalIdentitiesTable,
  // Topic-keyed knowledge facts (manual today; the chat-side approve-first
  // tool returns with the knowledge capability). Metadata + version chain
  // live HERE; the indexed CONTENT rides the documents pipeline into the
  // per-org corpus — consistent with the "content outside Convex" doctrine.
  knowledgeEntries: knowledgeEntriesTable,
  loginAttempts: loginAttemptsTable,
  loginBlockCounters: loginBlockCountersTable,
  notifications: notificationsTable,
  objectStorageBackfillRuns: objectStorageBackfillRunsTable,
  onedriveSyncConfigs: onedriveSyncConfigsTable,
  // The discussion-thread container (task/project/automation discussions);
  // predates the chat rewrite but is live — see discussions/schema.ts.
  threadMetadata: threadMetadataTable,
  twoFactorAttempts: twoFactorAttemptsTable,
  userNotificationState: userNotificationStateTable,
  userPasswordMetadata: userPasswordMetadataTable,
  userPreferences: userPreferencesTable,
  products: productsTable,
  projects: projectsTable,
  // AI-provider credentials (rewrite): org-scoped, multiple per provider
  // connector, secrets encrypted via lib/secret_box. Tenant isolation: every
  // read/write goes through the `by_org` / `by_org_provider` indexes; nothing
  // in this table is shared across organizations. See
  // `provider_credentials/schema.ts`.
  providerCredentials: providerCredentialsTable,
  tasks: tasksTable,
  taskDiscussionMessageMeta: taskDiscussionMessageMetaTable,
  taskActivity: taskActivityTable,
  taskDependencies: taskDependenciesTable,
  boardViews: boardViewsTable,
  // Deferred drop (see legacy/schema.ts) — forever empty on 0.4+.
  taskAgentRuns: taskAgentRunsTable,
  projectSecrets: projectSecretsTable,
  agentSecretAccess: agentSecretAccessTable,
  userNotifications: userNotificationsTable,
  taskSubscriptions: taskSubscriptionsTable,
  notificationPreferences: notificationPreferencesTable,
  // Unified Enterprise SSO + Provisioning. One connection per org carrying the
  // OIDC/OAuth2/SAML sign-in config, the role/team provisioning policy, and the
  // inbound SCIM token; `ssoProvisioningLinks` holds per-resource externalId /
  // restore-role.
  ssoConnections: ssoConnectionsTable,
  ssoProvisioningLinks: ssoProvisioningLinksTable,
  // Customer support portal (issue #1923): org-scoped cases worked by support
  // staff through their lifecycle, with escalation, SLA and a comment thread.
  // See `support_cases/schema.ts`.
  supportCases: supportCasesTable,
  supportCaseComments: supportCaseCommentsTable,
  supportCaseActivity: supportCaseActivityTable,
  sandboxSessions: sandboxSessionsTable,
  sandboxSessionTokens: sandboxSessionTokensTable,
  sandboxSessionOps: sandboxSessionOpsTable,
  sandboxAgentCheckpoints: sandboxAgentCheckpointsTable,
  sandboxAdmissionTickets: sandboxAdmissionTicketsTable,
  sandboxCredentialAccess: sandboxCredentialAccessTable,
  sandboxIntegrationCalls: sandboxIntegrationCallsTable,
  sandboxToolCalls: sandboxToolCallsTable,
  sandboxUserEnv: sandboxUserEnvTable,
  videoLinkJobs: videoLinkJobsTable,
  browserSessions: browserSessionsTable,
  webdavAppPasswords: webdavAppPasswordsTable,
  webdavLocks: webdavLocksTable,
  websites: websitesTable,
  // Deferred drop (see legacy/schema.ts) — forever empty on 0.4+.
  wfExecutions: wfExecutionsTable,
});
