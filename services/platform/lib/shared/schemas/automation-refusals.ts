/**
 * The codes an automation door refuses with: every `AutomationError` the
 * store and its doors throw, and the codes the authoring gate answers beside
 * them (`AUTOMATION_INVALID`, `AUTOMATION_TESTS_FAILING`). A refusal carries
 * its code, an English sentence for the API, the CLI and the logs, and under
 * `data` the facts that sentence names; the app words it in the reader's
 * language by its code (`app/features/automations/lib/refusal-text.ts`).
 *
 * `AutomationError` takes only a code listed here, so a new refusal fails the
 * type check until it is listed, and `lib/i18n/automation-refusal-keys.test.ts`
 * fails until it has its words in every locale.
 */

export const AUTOMATION_REFUSAL_CODES = [
  'APPROVAL_ALLOWANCE_INVALID',
  'AUTOMATION_DELETED',
  'AUTOMATION_DELIVERY_SCOPE_MISMATCH',
  'AUTOMATION_DEPLOYMENT_STALE',
  'AUTOMATION_DEPLOY_REJECTED',
  'AUTOMATION_HAS_ACTIVE_RUNS',
  'AUTOMATION_INPUT_INVALID',
  'AUTOMATION_INVALID',
  'AUTOMATION_NAME_INVALID',
  'AUTOMATION_NAME_RESERVED',
  'AUTOMATION_NAME_TAKEN',
  'AUTOMATION_NOT_DEPLOYED',
  'AUTOMATION_NOT_FOUND',
  'AUTOMATION_NOT_INSTALLED',
  'AUTOMATION_PROJECT_FORBIDDEN',
  'AUTOMATION_PROJECT_SCOPE_REQUIRED',
  'AUTOMATION_PROJECT_UNKNOWN',
  'AUTOMATION_TESTS_FAILING',
  'AUTOMATION_TRIGGER_INVALID',
  'AUTOMATION_VERSION_NOT_DEPLOYED',
  'AUTOMATION_VERSION_STALE',
  'AUTOMATION_VERSION_UNKNOWN',
  'EMPTY_ANSWER',
  'HUMAN_ASK_EXPIRED',
  'HUMAN_ASK_NOT_FOUND',
  'HUMAN_ASK_NOT_PENDING',
  'IDEMPOTENCY_KEY_REUSED',
  'IN_DOUBT_ALREADY_RESOLVED',
  'INVALID_CURSOR',
  'NODE_RUN_NOT_FOUND',
  'PROJECT_ARCHIVED',
  'PROJECT_NOT_FOUND',
  'REPLAY_GRAPH_CHANGED',
  'REPLAY_INPUT_UNAVAILABLE',
  'REPLAY_MODE_MISMATCH',
  'REPLAY_NODE_UNKNOWN',
  'REPLAY_PROGRESS_UNREADABLE',
  'REPLAY_RUN_NOT_FINISHED',
  'RUN_ACTIVE',
  'RUN_COMPARE_MISMATCH',
  'RUN_NOT_FOUND',
  'RUN_NOT_IN_DOUBT',
  'RUN_QUARANTINED',
  'RUN_QUARANTINE_CHANGED',
  'TEMPLATE_ANSWERS_INVALID',
  'TEMPLATE_CONNECTION_MISSING',
  'TEMPLATE_NOT_FOUND',
] as const;

export type AutomationRefusalCode = (typeof AUTOMATION_REFUSAL_CODES)[number];

export function isAutomationRefusalCode(
  code: unknown,
): code is AutomationRefusalCode {
  return (
    typeof code === 'string' &&
    (AUTOMATION_REFUSAL_CODES as readonly string[]).includes(code)
  );
}
