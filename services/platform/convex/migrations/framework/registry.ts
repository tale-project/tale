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
import { migration as ssoUnify } from '../versions/v0_2_86/01_enterprise_sso_unify';
import { meta as ssoUnifyMeta } from '../versions/v0_2_86/01_enterprise_sso_unify/meta';
import type { DbMigration, MigrationMeta } from './types';

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
];

/** Runnable `db` migrations, keyed by `meta.id`. */
export const DB_MIGRATIONS: Readonly<Record<string, DbMigration>> = {
  [gov02.meta.id]: gov02,
  [gov03.meta.id]: gov03,
  [ssoUnify.meta.id]: ssoUnify,
};
