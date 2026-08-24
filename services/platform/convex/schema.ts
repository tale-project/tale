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

import { agentSecretsTable } from './agent_secrets/schema';
import { approvalsTable } from './approvals/schema';
import {
  auditIntegrityProgressTable,
  auditLogChainGenesisTable,
  auditLogsTable,
} from './audit_logs/schema';
import {
  automationDeploymentsTable,
  automationHumanAsksTable,
  automationProjectBindingsTable,
  automationRunsTable,
  automationsTable,
  automationTombstonesTable,
  automationTriggersTable,
  automationUploadIntentsTable,
} from './automations/schema';
import { browserSessionsTable } from './browser_sessions/schema';
import {
  deferredSendsTable,
  generationsTable,
  memoriesTable,
  messagesTable,
  threadsTable,
} from './chat/schema';
import { chatFilterEventsTable } from './chat_filter_events/schema';
import {
  cloudImportOauthStatesTable,
  userCloudAuthorizationsTable,
} from './cloud_import/schema';
import {
  notificationPreferencesTable,
  taskSubscriptionsTable,
  userNotificationsTable,
} from './collab/schema';
import { connectorCredentialsTable } from './connector_credentials/schema';
import { contactsTable } from './contacts/schema';
import { backendControlTable } from './control/schema';
import {
  conversationsTable,
  conversationMessagesTable,
} from './conversations/schema';
import { threadMetadataTable } from './discussions/schema';
import {
  controlledDocumentReplacementUploadsTable,
  documentsTable,
} from './documents/schema';
import {
  ssoConnectionsTable,
  ssoProvisioningLinksTable,
} from './enterprise_sso/schema';
import { messageFeedbackTable } from './feedback/schema';
import { fileMetadataTable } from './file_metadata/schema';
import { foldersTable } from './folders/schema';
import { googleDriveSyncConfigsTable } from './google_drive/schema';
import {
  activeErasureClaimsTable,
  activeLegalHoldClaimsTable,
  auditLogCheckpointsTable,
  competenceRecordsTable,
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
  connectorOauthStatesTable,
  slackTeamRoutesTable,
} from './http_connectors/schema';
import { externalIdentitiesTable } from './identities/external_identities_schema';
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
import {
  projectAgentsTable,
  projectsTable,
  restUploadIntentsTable,
} from './projects/schema';
import {
  agentSecretAccessTable,
  projectSecretsTable,
} from './projects/secrets/schema';
import { providerCredentialsTable } from './provider_credentials/schema';
import {
  sandboxAdmissionTicketsTable,
  sandboxAgentCheckpointsTable,
  sandboxCredentialAccessTable,
  sandboxSessionOpsTable,
  sandboxSessionsTable,
  sandboxSessionTokensTable,
  sandboxConnectorCallsTable,
  sandboxToolCallsTable,
  sandboxTurnEventsTable,
  sandboxUserEnvTable,
} from './sandbox/sessions_schema';
import { skillUploadClaimTable, skillUploadIntentTable } from './skills/schema';
import {
  supportCaseActivityTable,
  supportCaseCommentsTable,
  supportCasesTable,
} from './support_cases/schema';
import {
  boardViewsTable,
  taskActivityTable,
  projectAgentRunsTable,
  taskDependenciesTable,
  taskDiscussionMessageMetaTable,
  taskLabelsTable,
  tasksTable,
} from './tasks/schema';
import { ttsAudioChunksTable, ttsGcCursorTable } from './tts/schema';
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
  // The automation store: immutable automation versions, the single deployed
  // version per automation, what starts a run, and the durable run log whose
  // per-node `checkpoints` let an interrupted run resume instead of repeating
  // side effects. Tenant isolation: every row carries `organizationId` and
  // every read goes through a `by_org…` index. See `automations/schema.ts`.
  automations: automationsTable,
  automationProjectBindings: automationProjectBindingsTable,
  automationDeployments: automationDeploymentsTable,
  automationTriggers: automationTriggersTable,
  automationRuns: automationRunsTable,
  automationUploadIntents: automationUploadIntentsTable,
  automationHumanAsks: automationHumanAsksTable,
  automationTombstones: automationTombstonesTable,
  // Chat storage. `generations` is split out because it is the only hot-written
  // row during a turn — keeping it out of `threads` means a streaming turn does
  // not rewrite a row every thread list reads. `memories` are pending until a
  // user approves them. See `chat/schema.ts`.
  threads: threadsTable,
  messages: messagesTable,
  generations: generationsTable,
  deferredSends: deferredSendsTable,
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
  competenceRecords: competenceRecordsTable,
  chatFilterEvents: chatFilterEventsTable,
  usageLedger: usageLedgerTable,
  messageFeedback: messageFeedbackTable,
  // App-native cache of Better Auth `member` rows for the RLS hot path
  // (getUserOrganizations / isOrgMember). Performance optimization only —
  // never the authoritative gate. See `members/schema.ts`.
  memberMirror: memberMirrorTable,
  memberMirrorReconcileCursor: memberMirrorReconcileCursorTable,
  // Transient plumbing for skill-bundle zip uploads — a per-(org, slug)
  // exclusion lock and the storageId→(org, user) binding. NOT skill data:
  // skills themselves are org-config files under `<org>/skills/`. See
  // `skills/schema.ts`.
  skillUploadClaims: skillUploadClaimTable,
  skillUploadIntents: skillUploadIntentTable,
  // Local mirror of Better Auth's `teamMember` table — the team-level
  // counterpart of memberMirror, so getUserTeamIds (the other half of the RLS
  // prime) also reads locally instead of cross-component. See members/schema.ts.
  teamMemberMirror: teamMemberMirrorTable,
  conversationMessages: conversationMessagesTable,
  conversations: conversationsTable,
  contacts: contactsTable,
  documents: documentsTable,
  controlledDocumentReplacementUploads:
    controlledDocumentReplacementUploadsTable,
  fileMetadata: fileMetadataTable,
  folders: foldersTable,
  // Connector credentials (rewrite): org-scoped, MULTIPLE per shipped
  // connector, every secret inside one `encryptedData` envelope via
  // lib/secret_box. Tenant isolation: every read/write goes through the
  // `by_org` / `by_org_connector` indexes; nothing in this table is shared
  // across organizations. See `connector_credentials/schema.ts`.
  connectorCredentials: connectorCredentialsTable,
  // Org agent secrets: named, encrypted credentials handed to an agent's
  // sandbox turn as ENVIRONMENT VARIABLES — the escape hatch below the
  // connector catalog for services with no shipped connector. Secret material
  // lives in one `lib/secret_box` envelope; injection is per-exec and audited.
  // Tenant isolation: every read/write goes through the `by_org` / `by_org_name`
  // indexes; nothing here is shared across organizations. See
  // `agent_secrets/schema.ts`.
  agentSecrets: agentSecretsTable,
  // Pending OAuth2 authorizations — one short-lived row per consent redirect,
  // holding the org/user/connector the callback is allowed to act for plus the
  // PKCE verifier. Consumed (deleted) on callback, so it is single-use by
  // construction; expired rows are swept when the next one is minted. See
  // `http_connectors/schema.ts`.
  connectorOauthStates: connectorOauthStatesTable,
  // Per-user Knowledge cloud-import grants (OneDrive / Google Drive). Not org
  // connectors and not login identity — intentional consent to import into
  // Documents. Tenant isolation: `by_org_user_provider`. See cloud_import/.
  userCloudAuthorizations: userCloudAuthorizationsTable,
  // Pending cloud-import OAuth states (hashed state + PKCE). See cloud_import/.
  cloudImportOauthStates: cloudImportOauthStatesTable,
  // Inbound Slack routing: `team_id` → the organization that installed the app.
  // Tenant isolation: a workspace maps to exactly one organization, an unmapped
  // workspace is refused, and resolution reads only the `by_team` index — no
  // event is ever fanned out across orgs. See `http_connectors/schema.ts`.
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
  // Per-user Google Drive sync targets for Knowledge Documents. Same shape as
  // onedriveSyncConfigs; tenant isolation via organizationId indexes.
  googleDriveSyncConfigs: googleDriveSyncConfigsTable,
  // The thread container (task-comment and automation threads); predates
  // the chat rewrite but is live — see discussions/schema.ts.
  threadMetadata: threadMetadataTable,
  ttsAudioChunks: ttsAudioChunksTable,
  ttsGcCursor: ttsGcCursorTable,
  twoFactorAttempts: twoFactorAttemptsTable,
  userNotificationState: userNotificationStateTable,
  userPasswordMetadata: userPasswordMetadataTable,
  userPreferences: userPreferencesTable,
  products: productsTable,
  projectAgents: projectAgentsTable,
  projects: projectsTable,
  // Transient plumbing for the projects REST upload lane — the single-use
  // uploadId→(org, user, project, s3Ref?) handshake rows. NOT file data:
  // bound files live on documents/fileMetadata. TTL'd + lazily swept; see
  // `projects/rest_upload_intents.ts`.
  restUploadIntents: restUploadIntentsTable,
  // AI-provider credentials (rewrite): org-scoped, multiple per provider
  // connector, secrets encrypted via lib/secret_box. Tenant isolation: every
  // read/write goes through the `by_org` / `by_org_provider` indexes; nothing
  // in this table is shared across organizations. See
  // `provider_credentials/schema.ts`.
  providerCredentials: providerCredentialsTable,
  tasks: tasksTable,
  taskLabels: taskLabelsTable,
  projectAgentRuns: projectAgentRunsTable,
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
  sandboxConnectorCalls: sandboxConnectorCallsTable,
  sandboxToolCalls: sandboxToolCallsTable,
  sandboxTurnEvents: sandboxTurnEventsTable,
  sandboxUserEnv: sandboxUserEnvTable,
  videoLinkJobs: videoLinkJobsTable,
  browserSessions: browserSessionsTable,
  webdavAppPasswords: webdavAppPasswordsTable,
  webdavLocks: webdavLocksTable,
  websites: websitesTable,
  // Deferred drop (see legacy/schema.ts) — forever empty on 0.4+.
  wfExecutions: wfExecutionsTable,
});
