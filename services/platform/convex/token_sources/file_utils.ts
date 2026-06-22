'use node';

import path from 'node:path';

import type {
  TokenSource,
  TokenSourceSecrets,
} from '../../lib/shared/schemas/token_sources';
import {
  tokenSourceSchema,
  tokenSourceSecretsSchema,
} from '../../lib/shared/schemas/token_sources';
import {
  errnoCode,
  getConfigRoot,
  readJsonFile,
  safeJoinWithinDir,
  validateOrgSlug,
} from '../lib/file_io';
import { decryptSecretsFile } from '../lib/sops';
import { validateTokenSourceSlug } from './validators';

const MAX_FILE_SIZE_BYTES = 256 * 1024;

export type TokenSourceReadResult =
  | { ok: true; config: TokenSource; hash: string }
  | {
      ok: false;
      error:
        | 'not_found'
        | 'corrupted'
        | 'too_large'
        | 'symlink'
        | 'inaccessible';
      message: string;
    };

export function resolveTokenSourcesDir(orgSlug: string): string {
  if (!validateOrgSlug(orgSlug))
    throw new Error(`Invalid org slug: ${orgSlug}`);
  return path.join(getConfigRoot('token-sources'), orgSlug, 'token-sources');
}

export function resolveTokenSourceFilePath(
  orgSlug: string,
  slug: string,
): string {
  if (!validateTokenSourceSlug(slug)) {
    throw new Error(`Invalid token source slug: ${slug}`);
  }
  return safeJoinWithinDir(resolveTokenSourcesDir(orgSlug), `${slug}.json`);
}

export function resolveTokenSourceSecretsPath(
  orgSlug: string,
  slug: string,
): string {
  if (!validateTokenSourceSlug(slug)) {
    throw new Error(`Invalid token source slug: ${slug}`);
  }
  return safeJoinWithinDir(
    resolveTokenSourcesDir(orgSlug),
    `${slug}.secrets.json`,
  );
}

export function parseTokenSourceSecrets(
  data: Record<string, unknown>,
): TokenSourceSecrets {
  const result = tokenSourceSecretsSchema.safeParse(data);
  if (!result.success) {
    throw new Error(`Invalid token source secrets: ${result.error.message}`);
  }
  return result.data;
}

/**
 * The broker auth secret from the encrypted `<slug>.secrets.json` sidecar, or
 * null when there is none (the caller then falls back to the `auth.secretEnv`
 * env-ref). A missing sidecar is the common, non-error case.
 */
export async function loadTokenSourceSecret(
  orgSlug: string,
  slug: string,
): Promise<string | null> {
  const p = resolveTokenSourceSecretsPath(orgSlug, slug);
  try {
    const raw = await decryptSecretsFile(p);
    return parseTokenSourceSecrets(raw).authSecret;
  } catch (err) {
    if (errnoCode(err) !== 'ENOENT') {
      console.warn(
        `[token-source] secrets for "${slug}" unreadable:`,
        err instanceof Error ? err.message : String(err),
      );
    }
    return null;
  }
}

export function parseTokenSourceJson(content: string): TokenSource {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- raw JSON before Zod validation
  const parsed = JSON.parse(content) as unknown;
  const result = tokenSourceSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid token source JSON: ${result.error.message}`);
  }
  return result.data;
}

/** Read + validate a single token source by slug from the org's config dir. */
export async function loadTokenSource(
  orgSlug: string,
  slug: string,
): Promise<TokenSourceReadResult> {
  const filePath = resolveTokenSourceFilePath(orgSlug, slug);
  const result = await readJsonFile<TokenSource>(
    filePath,
    MAX_FILE_SIZE_BYTES,
    parseTokenSourceJson,
  );
  if (result.ok) return { ok: true, config: result.data, hash: result.hash };
  return result;
}
