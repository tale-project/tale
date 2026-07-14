/**
 * The standalone-workflow → automation cutover map, shared by the 0.3.4
 * cutover migrations (33 automations seed, 35 workflows-tree removal, 36–40
 * row remaps, 43 retired-install sweep). A workflow definition now lives ONLY
 * inline in its automation's `automation.json`; the inline workflow's slug IS
 * the automation slug.
 *
 * Pure data — importable from db (V8) and node migrations alike.
 */

/**
 * Old standalone workflow slug (the org-tree relative path without `.json`)
 * → the automation that now carries that workflow inline. Covers the 13
 * auto-installed pack workflows, the 8 catalog templates, and the 3 email
 * syncs folded into their reply automations.
 */
export const WORKFLOW_TO_AUTOMATION: Readonly<Record<string, string>> = {
  // Task-ops pack (hidden, autoInstall, folder "tasks").
  'projects/tasks/run-assigned-task': 'run-assigned-task',
  'projects/tasks/triage-unassigned-tasks': 'triage-unassigned-tasks',
  'projects/tasks/react-to-task-mention': 'react-to-task-mention',
  'projects/tasks/review-completed-work': 'review-completed-work',
  'projects/tasks/sweep-stale-work': 'sweep-stale-work',
  'projects/tasks/start-queued-work': 'start-queued-work',
  'projects/tasks/archive-closed-tasks': 'archive-closed-tasks',
  'projects/tasks/enforce-task-slas': 'enforce-task-slas',
  'projects/tasks/unblock-dependent-tasks': 'unblock-dependent-tasks',
  'projects/tasks/roll-up-completed-subtasks': 'roll-up-completed-subtasks',
  'projects/tasks/remind-pending-reviewers': 'remind-pending-reviewers',
  // Discussion pack (hidden, autoInstall, folder "discussions").
  'projects/discussions/react-to-discussion-mention':
    'react-to-discussion-mention',
  // Knowledge / commerce / conversations templates.
  'onedrive/sync-files-from-onedrive': 'sync-onedrive-files',
  'confluence/sync-pages-from-confluence': 'sync-confluence-pages',
  'google_drive/sync-files-from-google-drive': 'sync-google-drive-files',
  'shopify/sync-customers-from-shopify': 'sync-shopify-customers',
  'shopify/sync-products-from-shopify': 'sync-shopify-products',
  'products/analyze-product-relationships': 'analyze-product-relationships',
  'knowledge/index-documents-for-retrieval': 'index-documents-for-retrieval',
  'conversations/archive-idle-conversations': 'archive-idle-conversations',
  'conversations/notify-members-on-inbound-message':
    'notify-members-on-inbound-message',
  // Email syncs folded INLINE into the existing reply automations.
  'gmail/sync-emails-from-gmail': 'reply-gmail-emails',
  'outlook/sync-emails-from-outlook': 'reply-outlook-emails',
  'imap_smtp/sync-emails-from-imap_smtp': 'reply-imap-emails',
};

/** Inverse of {@link WORKFLOW_TO_AUTOMATION}, for the bijective `down`s. */
export const AUTOMATION_TO_WORKFLOW: Readonly<Record<string, string>> =
  Object.fromEntries(
    Object.entries(WORKFLOW_TO_AUTOMATION).map(([from, to]) => [to, from]),
  );

/**
 * Standalone workflows RETIRED outright (no successor row remap): the two
 * GitHub templates superseded by the `sync-github-issues` / `review-github-pr`
 * automations, and the generic mail-sync ancestor of the three folded email
 * syncs. Their org files die with the workflows tree (35); their
 * `wfInstallations` rows are swept by 43 (leftover trigger rows are inert
 * without an installation — `processEvent` and the scheduler both gate on it).
 */
export const RETIRED_STANDALONE_WORKFLOW_SLUGS = [
  'github/sync-issues-from-github',
  'github/review-pull-request-in-github',
  'conversations/sync-messages-to-conversations',
] as const;

/**
 * Free-floating builtin agents retired with the GitHub bundle mechanism —
 * automations ship their own nested agents now (`review-github-pr/pr-reviewer`
 * etc.). `software-developer` is absent here on purpose: migration 0.3.4/05
 * already sweeps that slug (the recycled workforce persona list).
 */
export const RETIRED_AGENT_SLUGS = [
  'issue-triager',
  'pull-request-reviewer',
] as const;

/**
 * `installedBy` marker on every `automationInstallations` row migration 41
 * creates, so its `down` deletes exactly its own rows. FROZEN: persisted in
 * deployments that ran the migration — never rename.
 */
export const MIGRATION_INSTALLED_BY =
  'migration:v0_3_4_workflows_become_automations';
