import type { Sql, TransactionSql } from 'postgres';

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
  onboardingCompleted?: boolean;
  updatedAt: number;
}

interface PreferencesRow {
  customInstructions: string;
  customInstructionsEnabled: boolean | null;
  memoriesEnabled: boolean | null;
  voiceOutput: boolean | null;
  chatModelId: string | null;
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
    ...(row.onboardingCompleted !== null
      ? { onboardingCompleted: row.onboardingCompleted }
      : {}),
    updatedAt: row.updatedAt,
  };
}

/** The user's sticky chat model pick, for system work done on their behalf. */
export async function getChatModel(
  sql: Sql | TransactionSql,
  scope: { userId: string; orgId: string },
): Promise<string | null> {
  const rows = await sql<{ chatModelId: string | null }[]>`
    SELECT chat_model_id AS "chatModelId" FROM app.user_preferences
    WHERE user_id = ${scope.userId} AND org_id = ${scope.orgId}
  `;
  return rows[0]?.chatModelId ?? null;
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

/**
 * Remember the composer's EXPLICIT model pick; an absent `modelId` is the
 * explicit pick of Auto and clears the stored id.
 */
export async function setChatModel(
  tx: TransactionSql,
  scope: { userId: string; orgId: string },
  modelId: string | undefined,
): Promise<void> {
  if (modelId !== undefined && !CHAT_MODEL_ID_RE.test(modelId)) {
    throw new PreferencesError(
      'invalid_model_id',
      'Model ids are short printable identifiers.',
    );
  }
  await tx`
    INSERT INTO app.user_preferences (
      user_id, org_id, custom_instructions, chat_model_id, updated_at
    ) VALUES (
      ${scope.userId}, ${scope.orgId}, '', ${modelId ?? null}, ${Date.now()}
    )
    ON CONFLICT (user_id, org_id) DO UPDATE SET
      chat_model_id = ${modelId ?? null}, updated_at = ${Date.now()}
  `;
}
