import type { Sql, TransactionSql } from 'postgres';

import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';

/**
 * Per-user, per-org personalization preferences (0.4 `userPreferences`).
 * Tri-state feature flags: null = follow the org governance default,
 * true/false = the user's explicit override. Admins cannot read another
 * user's row — every entry point scopes by the SESSION user id.
 */

export interface UserPreferences {
  userId: string;
  organizationId: string;
  customInstructions: string;
  customInstructionsEnabled?: boolean;
  memoriesEnabled?: boolean;
  voiceOutput?: boolean;
  chatModelId?: string;
  /** The connector that served `chatModelId` when it was picked. Absent on a
   * pick saved before providers were part of it — such a pick resolves by id
   * alone, the first connector listing it. */
  chatModelProviderSlug?: string;
  onboardingCompleted?: boolean;
  updatedAt: number;
}

/** The sticky chat model pick: the model id and, when the pick carried one,
 * the provider serving it. */
export interface ChatModelPick {
  modelId: string;
  providerSlug?: string;
}

interface PreferencesRow {
  customInstructions: string;
  customInstructionsEnabled: boolean | null;
  memoriesEnabled: boolean | null;
  voiceOutput: boolean | null;
  chatModelId: string | null;
  chatModelProviderSlug: string | null;
  onboardingCompleted: boolean | null;
  updatedAt: number;
}

export class PreferencesError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PreferencesError';
    this.code = code;
  }
}

export async function getMyPreferences(
  sql: Sql,
  scope: { userId: string; orgId: string },
): Promise<UserPreferences | null> {
  const rows = await sql<PreferencesRow[]>`
    SELECT custom_instructions AS "customInstructions",
           custom_instructions_enabled AS "customInstructionsEnabled",
           memories_enabled AS "memoriesEnabled",
           voice_output AS "voiceOutput",
           chat_model_id AS "chatModelId",
           chat_model_provider_slug AS "chatModelProviderSlug",
           onboarding_completed AS "onboardingCompleted",
           updated_at::float8 AS "updatedAt"
    FROM app.user_preferences
    WHERE user_id = ${scope.userId} AND org_id = ${scope.orgId}
  `;
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    userId: scope.userId,
    organizationId: scope.orgId,
    customInstructions: row.customInstructions,
    ...(row.customInstructionsEnabled !== null
      ? { customInstructionsEnabled: row.customInstructionsEnabled }
      : {}),
    ...(row.memoriesEnabled !== null
      ? { memoriesEnabled: row.memoriesEnabled }
      : {}),
    ...(row.voiceOutput !== null ? { voiceOutput: row.voiceOutput } : {}),
    ...(row.chatModelId !== null ? { chatModelId: row.chatModelId } : {}),
    // The provider only means something next to a model id: a slug left
    // behind by a cleared pick is never surfaced on its own.
    ...(row.chatModelId !== null && row.chatModelProviderSlug !== null
      ? { chatModelProviderSlug: row.chatModelProviderSlug }
      : {}),
    ...(row.onboardingCompleted !== null
      ? { onboardingCompleted: row.onboardingCompleted }
      : {}),
    updatedAt: row.updatedAt,
  };
}

/**
 * The custom instructions the chat assistant follows for this person, or
 * `null`. The gate is the cascade the preferences page renders
 * (`resolveGate`): the person's explicit toggle wins, otherwise the org's
 * `custom_instructions` policy default, and with neither the feature is OFF.
 * Blank text reads as none even while the feature is on — a block saying
 * nothing would still cost the model a header.
 */
export function effectiveCustomInstructions(
  preferences: Pick<
    UserPreferences,
    'customInstructions' | 'customInstructionsEnabled'
  > | null,
  policy: { enabled: boolean } | null,
): string | null {
  const enabled =
    preferences?.customInstructionsEnabled ?? policy?.enabled ?? false;
  if (!enabled) return null;
  const text = preferences?.customInstructions.trim() ?? '';
  return text.length > 0 ? text : null;
}

/** {@link effectiveCustomInstructions} over the person's row and the org's
 * policy file — what a chat turn reads for its prompt. */
export async function getEffectiveCustomInstructions(
  sql: Sql,
  scope: { userId: string; orgId: string },
): Promise<string | null> {
  const [preferences, policy] = await Promise.all([
    getMyPreferences(sql, scope),
    readGovernancePolicyForOrg(sql, scope.orgId, 'custom_instructions'),
  ]);
  return effectiveCustomInstructions(preferences, policy);
}

/** The user's sticky chat model pick, for system work done on their behalf. */
export async function getChatModel(
  sql: Sql | TransactionSql,
  scope: { userId: string; orgId: string },
): Promise<ChatModelPick | null> {
  const rows = await sql<
    { chatModelId: string | null; chatModelProviderSlug: string | null }[]
  >`
    SELECT chat_model_id AS "chatModelId",
           chat_model_provider_slug AS "chatModelProviderSlug"
    FROM app.user_preferences
    WHERE user_id = ${scope.userId} AND org_id = ${scope.orgId}
  `;
  return chatModelPickOf(rows[0]);
}

/** The pick a preferences row carries, or null when the user never pinned a
 * model (or cleared the pin by choosing Auto). */
export function chatModelPickOf(
  row:
    | { chatModelId: string | null; chatModelProviderSlug: string | null }
    | undefined,
): ChatModelPick | null {
  if (row === undefined || row.chatModelId === null) return null;
  return {
    modelId: row.chatModelId,
    ...(row.chatModelProviderSlug !== null
      ? { providerSlug: row.chatModelProviderSlug }
      : {}),
  };
}

// Soft length guard on a settings field (flat chars/4 approximation of the
// retired estimateTokens — see the 0.4 module comment).
function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }
  return Math.ceil(text.length / 4);
}

// oxlint-disable-next-line no-control-regex -- control characters are exactly what this guard rejects
const CUSTOM_INSTRUCTIONS_ILLEGAL_RE = /[<>`\x00-\x09\x0b-\x1f\x7f]/;
const CUSTOM_INSTRUCTIONS_MAX_CHARS = 5000;
const CUSTOM_INSTRUCTIONS_MAX_TOKENS = 800;

export async function upsertCustomInstructions(
  tx: TransactionSql,
  scope: { userId: string; orgId: string },
  customInstructions: string,
): Promise<void> {
  const normalized = customInstructions
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n');
  if (normalized.length > CUSTOM_INSTRUCTIONS_MAX_CHARS) {
    throw new PreferencesError(
      'too_long',
      `Custom instructions exceed ${CUSTOM_INSTRUCTIONS_MAX_CHARS} characters.`,
    );
  }
  if (
    normalized.length > 0 &&
    CUSTOM_INSTRUCTIONS_ILLEGAL_RE.test(normalized)
  ) {
    throw new PreferencesError(
      'invalid',
      'Custom instructions contain disallowed characters (angle brackets, ' +
        'backticks, or control characters).',
    );
  }
  const tokens = estimateTokens(normalized);
  if (tokens > CUSTOM_INSTRUCTIONS_MAX_TOKENS) {
    throw new PreferencesError(
      'too_long',
      `Custom instructions exceed ${CUSTOM_INSTRUCTIONS_MAX_TOKENS} token budget (got ~${tokens}).`,
    );
  }
  await tx`
    INSERT INTO app.user_preferences (
      user_id, org_id, custom_instructions, updated_at
    ) VALUES (${scope.userId}, ${scope.orgId}, ${normalized}, ${Date.now()})
    ON CONFLICT (user_id, org_id) DO UPDATE SET
      custom_instructions = ${normalized}, updated_at = ${Date.now()}
  `;
}

type FlagColumn =
  | 'custom_instructions_enabled'
  | 'memories_enabled'
  | 'voice_output'
  | 'onboarding_completed';

async function upsertFlag(
  tx: TransactionSql,
  scope: { userId: string; orgId: string },
  column: FlagColumn,
  value: boolean,
): Promise<void> {
  // Column name comes from the closed FlagColumn union above, never input.
  await tx`
    INSERT INTO app.user_preferences (
      user_id, org_id, custom_instructions, updated_at, ${tx.unsafe(column)}
    ) VALUES (${scope.userId}, ${scope.orgId}, '', ${Date.now()}, ${value})
    ON CONFLICT (user_id, org_id) DO UPDATE SET
      ${tx.unsafe(column)} = ${value}, updated_at = ${Date.now()}
  `;
}

export function setCustomInstructionsEnabled(
  tx: TransactionSql,
  scope: { userId: string; orgId: string },
  enabled: boolean,
): Promise<void> {
  return upsertFlag(tx, scope, 'custom_instructions_enabled', enabled);
}

export function setMemoriesEnabled(
  tx: TransactionSql,
  scope: { userId: string; orgId: string },
  enabled: boolean,
): Promise<void> {
  return upsertFlag(tx, scope, 'memories_enabled', enabled);
}

export function setVoiceOutput(
  tx: TransactionSql,
  scope: { userId: string; orgId: string },
  enabled: boolean,
): Promise<void> {
  return upsertFlag(tx, scope, 'voice_output', enabled);
}

export function setOnboardingCompleted(
  tx: TransactionSql,
  scope: { userId: string; orgId: string },
  completed: boolean,
): Promise<void> {
  return upsertFlag(tx, scope, 'onboarding_completed', completed);
}

// Provider-namespaced printable identifier, never free prose.
const CHAT_MODEL_ID_RE = /^[\x21-\x7e]{1,200}$/;
// A connector slug as the provider definition schema spells it.
const CHAT_MODEL_PROVIDER_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CHAT_MODEL_PROVIDER_SLUG_MAX = 120;

/**
 * Remember the composer's EXPLICIT model pick — the model id and the
 * provider that served it, so a later seed lands on the same copy when two
 * connectors list the id; an absent pick is the explicit choice of Auto and
 * clears both.
 */
export async function setChatModel(
  tx: TransactionSql,
  scope: { userId: string; orgId: string },
  pick: ChatModelPick | undefined,
): Promise<void> {
  if (pick !== undefined && !CHAT_MODEL_ID_RE.test(pick.modelId)) {
    throw new PreferencesError(
      'invalid_model_id',
      'Model ids are short printable identifiers.',
    );
  }
  if (
    pick?.providerSlug !== undefined &&
    (pick.providerSlug.length > CHAT_MODEL_PROVIDER_SLUG_MAX ||
      !CHAT_MODEL_PROVIDER_SLUG_RE.test(pick.providerSlug))
  ) {
    throw new PreferencesError(
      'invalid_provider_slug',
      'Provider slugs are lowercase letters, digits and single hyphens.',
    );
  }
  const modelId = pick?.modelId ?? null;
  const providerSlug = pick?.providerSlug ?? null;
  await tx`
    INSERT INTO app.user_preferences (
      user_id, org_id, custom_instructions, chat_model_id,
      chat_model_provider_slug, updated_at
    ) VALUES (
      ${scope.userId}, ${scope.orgId}, '', ${modelId}, ${providerSlug},
      ${Date.now()}
    )
    ON CONFLICT (user_id, org_id) DO UPDATE SET
      chat_model_id = ${modelId},
      chat_model_provider_slug = ${providerSlug},
      updated_at = ${Date.now()}
  `;
}
