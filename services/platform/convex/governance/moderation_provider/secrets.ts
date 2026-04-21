'use node';

import path from 'node:path';

import { z } from 'zod/v4';

import { decryptSecretsFile } from '../../lib/sops';
import { resolveProvidersDir } from '../../providers/file_utils';

/**
 * Separate SOPS-encrypted file from LLM provider secrets — the provider
 * secrets schema is closed (`apiKey`, `modelKeys`), so we can't piggyback on
 * it. v1 supports a single `authHeader` value (the full header value, e.g.
 * `Bearer sk-...`); v2 may expand to a flat `Record<string, string>` if
 * admins need multiple secrets.
 */

export const MODERATION_SECRETS_FILENAME = 'moderation.secrets.json';

const moderationSecretsSchema = z
  .object({
    authHeader: z.string().min(1),
  })
  .strict();

export type ModerationSecrets = z.infer<typeof moderationSecretsSchema>;

function resolveSecretsPath(orgSlug: string, fileName: string): string {
  const dir = resolveProvidersDir(orgSlug);
  const resolved = path.resolve(dir, fileName);
  const expectedPrefix = path.resolve(dir);
  if (
    !resolved.startsWith(expectedPrefix + path.sep) &&
    resolved !== expectedPrefix
  ) {
    throw new Error(
      `Refusing to read secrets path outside org dir: ${fileName}`,
    );
  }
  return resolved;
}

/**
 * Decrypt and validate the moderation secrets file for an org. Errors here
 * are surfaced as `step_error` by the caller; we never log the decrypted
 * value and never include it in audit metadata.
 */
export async function resolveModerationSecrets(
  orgSlug: string,
  fileName: string = MODERATION_SECRETS_FILENAME,
): Promise<ModerationSecrets> {
  const filePath = resolveSecretsPath(orgSlug, fileName);
  const raw = await decryptSecretsFile(filePath);
  const parsed = moderationSecretsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Invalid moderation secrets at ${fileName}: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}
