/**
 * The single source of truth for which migrations exist. Every migration MUST
 * be listed here or it will never run / never be reported, and the CI guard
 * (`scripts/check-migrations.ts`) fails the build if a migration folder on disk
 * is missing from this file.
 *
 * V8-safe: imports each migration's `meta` (always V8-safe) and each `db`
 * migration's handler module (also V8-safe). It must NOT import a `node`
 * migration's handler module — those are `'use node'`; their handlers live in
 * `registry.node.ts`. Node migrations contribute only their `meta` here.
 */

// --- meta (all migrations, every kind) -------------------------------------
// Reference migrations (kind:'reference') document data-shape changes that
// already shipped in tagged releases and CANNOT be replayed against today's
// schema. They contribute only their `meta` here (never to DB_MIGRATIONS) so
// they appear in the audit trail; the planner filters them out of execution.
import { meta as ref0_2_1_01Meta } from '../versions/v0_2_1/01_agent_bindings_agent_slug/meta';
import { meta as ref0_2_1_02Meta } from '../versions/v0_2_1/02_agent_webhooks_agent_slug/meta';
import { meta as ref0_2_14_01Meta } from '../versions/v0_2_14/01_usage_ledger_drop_cost_fields/meta';
import { meta as ref0_2_48_01Meta } from '../versions/v0_2_48/01_apikey_reference_id/meta';
import { meta as ref0_2_48_02Meta } from '../versions/v0_2_48/02_merge_audit_retention/meta';
import { meta as ref0_2_66_01Meta } from '../versions/v0_2_66/01_documents_source_provider_widen/meta';
import { meta as ref0_2_73_01Meta } from '../versions/v0_2_73/01_artifacts_to_thread_files/meta';
import { meta as ref0_2_73_02Meta } from '../versions/v0_2_73/02_personalization_split/meta';
import { meta as ref0_2_73_03Meta } from '../versions/v0_2_73/03_governance_personalization_policy_split/meta';
import { meta as gov01Meta } from '../versions/v0_2_85/01_governance_db_to_json/meta';
// --- db migration handlers --------------------------------------------------
import { migration as gov02 } from '../versions/v0_2_85/02_dsar_pending_table_split';
import { meta as gov02Meta } from '../versions/v0_2_85/02_dsar_pending_table_split/meta';
import { migration as gov03 } from '../versions/v0_2_85/03_drop_legacy_governance_tables';
import { meta as gov03Meta } from '../versions/v0_2_85/03_drop_legacy_governance_tables/meta';
import { meta as ssoUnifyMeta } from '../versions/v0_2_87/01_enterprise_sso_unify/meta';
// 02/03 are `node` export migrations — only their meta lives here (handlers in
// registry.node.ts); 04/05 are `db` drops — meta + handler both here.
import { meta as runCodeExportMeta } from '../versions/v0_2_87/02_run_code_policy_db_to_json/meta';
import { meta as modelSyncExportMeta } from '../versions/v0_2_87/03_model_sync_db_to_json/meta';
import { migration as dropOrgPackagePolicy } from '../versions/v0_2_87/04_drop_org_package_policy';
import { meta as dropOrgPackagePolicyMeta } from '../versions/v0_2_87/04_drop_org_package_policy/meta';
import { migration as dropModelSyncSettings } from '../versions/v0_2_87/05_drop_model_sync_settings';
import { meta as dropModelSyncSettingsMeta } from '../versions/v0_2_87/05_drop_model_sync_settings/meta';
import { migration as appConfigToBindings } from '../versions/v0_2_88/01_app_config_to_bindings';
import { meta as appConfigToBindingsMeta } from '../versions/v0_2_88/01_app_config_to_bindings/meta';
import { migration as appSchedulesPerProject } from '../versions/v0_2_88/02_app_schedules_per_project';
import { meta as appSchedulesPerProjectMeta } from '../versions/v0_2_88/02_app_schedules_per_project/meta';
// Reference-only (kind:'reference'): additive usageLedger.apiKeyId + apiKey
// budget scope. Contributes meta only; never runnable.
import { meta as apiKeyBudgetScopeMeta } from '../versions/v0_2_89/01_usage_ledger_apikey_budget_scope/meta';
import { migration as threadFilesAbsPaths } from '../versions/v0_2_89/02_thread_files_absolute_paths';
import { meta as threadFilesAbsPathsMeta } from '../versions/v0_2_89/02_thread_files_absolute_paths/meta';
import { meta as claudeCodeFableDefaultMeta } from '../versions/v0_2_89/03_claude_code_fable_default/meta';
import { meta as agentKindOpencodeMeta } from '../versions/v0_2_90/01_agent_kind_opencode_to_claude_code/meta';
import { meta as threadMetadataAppDiscussionMeta } from '../versions/v0_2_90/01_thread_metadata_app_discussion/meta';
import { migration as backfillConversationIntegrationName } from '../versions/v0_2_90/02_backfill_conversation_integration_name';
import { meta as backfillConversationIntegrationNameMeta } from '../versions/v0_2_90/02_backfill_conversation_integration_name/meta';
import { meta as installEmailAppsMeta } from '../versions/v0_2_90/03_install_email_apps/meta';
// 04/05/07 are `node` workforce-retirement migrations — meta only (handlers in
// registry.node.ts); 06/08 are `db` snapshot-deletes — meta + handler here.
import { meta as dropAgentWorkforcePolicyMeta } from '../versions/v0_2_90/04_drop_agent_workforce_policy/meta';
import { meta as removeWorkforceAgentsMeta } from '../versions/v0_2_90/05_remove_workforce_agents/meta';
import { migration as dropWorkforceAgentInstallations } from '../versions/v0_2_90/06_drop_workforce_agent_installations';
import { meta as dropWorkforceAgentInstallationsMeta } from '../versions/v0_2_90/06_drop_workforce_agent_installations/meta';
import { meta as removeRetiredTaskWorkflowsMeta } from '../versions/v0_2_90/07_remove_retired_task_workflows/meta';
import { migration as deleteWorkforceDigestNotifications } from '../versions/v0_2_90/08_delete_workforce_digest_notifications';
import { meta as deleteWorkforceDigestNotificationsMeta } from '../versions/v0_2_90/08_delete_workforce_digest_notifications/meta';
import { migration as appConfigToScheduleVariables } from '../versions/v0_2_91/01_app_config_to_schedule_variables';
import { meta as appConfigToScheduleVariablesMeta } from '../versions/v0_2_91/01_app_config_to_schedule_variables/meta';
// 01 is a `node` retirement migration — meta only (handler in
// registry.node.ts); 02 is a `db` additive trigger backfill.
import { meta as retireIssueDeskMeta } from '../versions/v0_2_92/01_retire_issue_desk/meta';
import { migration as triageBacklogStartTrigger } from '../versions/v0_2_92/02_triage_backlog_start_trigger';
import { meta as triageBacklogStartTriggerMeta } from '../versions/v0_2_92/02_triage_backlog_start_trigger/meta';
import { migration as automationSlugFields } from '../versions/v0_2_93/01_automation_slug_fields';
import { meta as automationSlugFieldsMeta } from '../versions/v0_2_93/01_automation_slug_fields/meta';
import { migration as appProjectBindingsAutomationSlug } from '../versions/v0_2_93/02_app_project_bindings_automation_slug';
import { meta as appProjectBindingsAutomationSlugMeta } from '../versions/v0_2_93/02_app_project_bindings_automation_slug/meta';
import { migration as threadMetadataAutomationSlug } from '../versions/v0_2_93/03_thread_metadata_automation_slug';
import { meta as threadMetadataAutomationSlugMeta } from '../versions/v0_2_93/03_thread_metadata_automation_slug/meta';
import { migration as appInstallationsTable } from '../versions/v0_2_93/04_app_installations_table';
import { meta as appInstallationsTableMeta } from '../versions/v0_2_93/04_app_installations_table/meta';
import { migration as appProjectBindingsTable } from '../versions/v0_2_93/05_app_project_bindings_table';
import { meta as appProjectBindingsTableMeta } from '../versions/v0_2_93/05_app_project_bindings_table/meta';
import { migration as appUploadClaimsTable } from '../versions/v0_2_93/06_app_upload_claims_table';
import { meta as appUploadClaimsTableMeta } from '../versions/v0_2_93/06_app_upload_claims_table/meta';
import { migration as appUploadIntentsTable } from '../versions/v0_2_93/07_app_upload_intents_table';
import { meta as appUploadIntentsTableMeta } from '../versions/v0_2_93/07_app_upload_intents_table/meta';
import { migration as threadMetadataAutomationDiscussion } from '../versions/v0_2_93/08_thread_metadata_automation_discussion';
import { meta as threadMetadataAutomationDiscussionMeta } from '../versions/v0_2_93/08_thread_metadata_automation_discussion/meta';
import { migration as normalizeAuthUserEmails } from '../versions/v0_3_3/01_normalize_auth_user_emails';
import { meta as normalizeAuthUserEmailsMeta } from '../versions/v0_3_3/01_normalize_auth_user_emails/meta';
// `node` file-rewrite migration — only its meta lives here (handler in
// registry.node.ts).
import { meta as brandingSingleAccentColorMeta } from '../versions/v0_3_4/01_branding_single_accent_color/meta';
import type { ComponentMigration, DbMigration, MigrationMeta } from './types';

/**
 * Every migration's metadata, in registration order. Ordering for execution is
 * derived from (semver, numericId) by the planner — registration order here is
 * irrelevant, but keep it chronological for readability.
 */
export const ALL_META: readonly MigrationMeta[] = [
  // Reference-only (not runnable; chronological).
  ref0_2_1_01Meta,
  ref0_2_1_02Meta,
  ref0_2_14_01Meta,
  ref0_2_48_01Meta,
  ref0_2_48_02Meta,
  ref0_2_66_01Meta,
  ref0_2_73_01Meta,
  ref0_2_73_02Meta,
  ref0_2_73_03Meta,
  // Runnable db/node migrations.
  gov01Meta,
  gov02Meta,
  gov03Meta,
  ssoUnifyMeta,
  runCodeExportMeta,
  modelSyncExportMeta,
  dropOrgPackagePolicyMeta,
  dropModelSyncSettingsMeta,
  appConfigToBindingsMeta,
  appSchedulesPerProjectMeta,
  apiKeyBudgetScopeMeta,
  threadFilesAbsPathsMeta,
  claudeCodeFableDefaultMeta,
  agentKindOpencodeMeta,
  normalizeAuthUserEmailsMeta,
  brandingSingleAccentColorMeta,
  threadMetadataAppDiscussionMeta,
  backfillConversationIntegrationNameMeta,
  installEmailAppsMeta,
  dropAgentWorkforcePolicyMeta,
  removeWorkforceAgentsMeta,
  dropWorkforceAgentInstallationsMeta,
  removeRetiredTaskWorkflowsMeta,
  deleteWorkforceDigestNotificationsMeta,
  appConfigToScheduleVariablesMeta,
  retireIssueDeskMeta,
  triageBacklogStartTriggerMeta,
  automationSlugFieldsMeta,
  appProjectBindingsAutomationSlugMeta,
  threadMetadataAutomationSlugMeta,
  appInstallationsTableMeta,
  appProjectBindingsTableMeta,
  appUploadClaimsTableMeta,
  appUploadIntentsTableMeta,
  threadMetadataAutomationDiscussionMeta,
];

/** Runnable `db` migrations, keyed by `meta.id`. */
export const DB_MIGRATIONS: Readonly<Record<string, DbMigration>> = {
  [gov02.meta.id]: gov02,
  [gov03.meta.id]: gov03,
  [dropOrgPackagePolicy.meta.id]: dropOrgPackagePolicy,
  [dropModelSyncSettings.meta.id]: dropModelSyncSettings,
  [appConfigToBindings.meta.id]: appConfigToBindings,
  [appSchedulesPerProject.meta.id]: appSchedulesPerProject,
  [threadFilesAbsPaths.meta.id]: threadFilesAbsPaths,
  [backfillConversationIntegrationName.meta.id]:
    backfillConversationIntegrationName,
  [dropWorkforceAgentInstallations.meta.id]: dropWorkforceAgentInstallations,
  [deleteWorkforceDigestNotifications.meta.id]:
    deleteWorkforceDigestNotifications,
  [appConfigToScheduleVariables.meta.id]: appConfigToScheduleVariables,
  [triageBacklogStartTrigger.meta.id]: triageBacklogStartTrigger,
  [automationSlugFields.meta.id]: automationSlugFields,
  [appProjectBindingsAutomationSlug.meta.id]: appProjectBindingsAutomationSlug,
  [threadMetadataAutomationSlug.meta.id]: threadMetadataAutomationSlug,
  [appInstallationsTable.meta.id]: appInstallationsTable,
  [appProjectBindingsTable.meta.id]: appProjectBindingsTable,
  [appUploadClaimsTable.meta.id]: appUploadClaimsTable,
  [appUploadIntentsTable.meta.id]: appUploadIntentsTable,
  [threadMetadataAutomationDiscussion.meta.id]:
    threadMetadataAutomationDiscussion,
};

/** Runnable `component` migrations, keyed by `meta.id`. */
export const COMPONENT_MIGRATIONS: Readonly<
  Record<string, ComponentMigration>
> = {
  [normalizeAuthUserEmails.meta.id]: normalizeAuthUserEmails,
};
