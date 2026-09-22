/**
 * Runtime configuration, read once from the environment.
 *
 * Two secrets have no safe default — the API key that guards the token
 * endpoints, and the key that encrypts the stored tokens — so production
 * refuses to boot without them and says which are missing. Development may
 * generate them for the session (`generateMissingSecrets`); they are printed
 * once and never written to disk, so a restart issues new ones.
 *
 * The panel itself holds no secret: it has no login of its own, and whatever
 * sits in front of the gateway decides who reaches it.
 */

import { randomBytes } from 'node:crypto';

import { z } from 'zod';

/** Bytes an AES-256-GCM key needs. */
const ENCRYPTION_KEY_BYTES = 32;

const secretNames = [
  'AI_GATEWAY_API_KEY',
  'AI_GATEWAY_ENCRYPTION_KEY',
] as const;

export type SecretName = (typeof secretNames)[number];

const positiveSeconds = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback);

const schema = z.object({
  AI_GATEWAY_API_KEY: z.string().min(1),
  AI_GATEWAY_ENCRYPTION_KEY: z.string().min(1),
  AI_GATEWAY_DATA_DIR: z.string().min(1).default('.data'),
  AI_GATEWAY_REFRESH_INTERVAL_SECONDS: positiveSeconds(300),
  AI_GATEWAY_USAGE_MIN_INTERVAL_SECONDS: positiveSeconds(180),
  AI_GATEWAY_TOKEN_REFRESH_SKEW_SECONDS: positiveSeconds(300),
  AI_GATEWAY_CLAUDE_CODE_VERSION: z.string().min(1).default('1.0.0'),
  AI_GATEWAY_ANTHROPIC_CLIENT_ID: z.string().min(1).optional(),
  AI_GATEWAY_OPENAI_CLIENT_ID: z.string().min(1).optional(),
});

export interface GatewayConfig {
  apiKey: string;
  encryptionKey: Buffer;
  dataDir: string;
  refreshIntervalSeconds: number;
  /** Floor between two usage reads for one account; the endpoints throttle. */
  usageMinIntervalSeconds: number;
  /** How long before expiry an access token is refreshed anyway. */
  tokenRefreshSkewSeconds: number;
  claudeCodeVersion: string;
  anthropicClientId: string | undefined;
  openAiClientId: string | undefined;
}

export class ConfigError extends Error {
  constructor(
    message: string,
    readonly missing: readonly string[] = [],
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** A fresh value for one of the two secrets, in the shape it is read back. */
function generateSecret(name: SecretName): string {
  return name === 'AI_GATEWAY_ENCRYPTION_KEY'
    ? randomBytes(ENCRYPTION_KEY_BYTES).toString('base64')
    : randomBytes(32).toString('base64url');
}

export interface LoadConfigOptions {
  /**
   * Fill absent secrets with generated values instead of refusing to boot.
   * Development only: nothing is persisted, so every restart issues a new API
   * key AND cannot decrypt anything stored before it.
   */
  generateMissingSecrets?: boolean;
}

export interface LoadedConfig {
  config: GatewayConfig;
  /** Secrets this load generated, so the caller can print them once. */
  generated: { name: SecretName; value: string }[];
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  options: LoadConfigOptions = {},
): LoadedConfig {
  const source: Record<string, string | undefined> = { ...env };
  const generated: { name: SecretName; value: string }[] = [];

  if (options.generateMissingSecrets) {
    for (const name of secretNames) {
      if (source[name]?.trim()) continue;
      const value = generateSecret(name);
      source[name] = value;
      generated.push({ name, value });
    }
  }

  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const missing = [
      ...new Set(parsed.error.issues.map((issue) => String(issue.path[0]))),
    ].sort();
    throw new ConfigError(
      `ai-gateway cannot start: ${missing.join(', ')} ${
        missing.length === 1 ? 'is' : 'are'
      } missing or invalid. See services/ai-gateway/README.md.`,
      missing,
    );
  }

  const encryptionKey = Buffer.from(
    parsed.data.AI_GATEWAY_ENCRYPTION_KEY,
    'base64',
  );
  if (encryptionKey.length !== ENCRYPTION_KEY_BYTES) {
    throw new ConfigError(
      `AI_GATEWAY_ENCRYPTION_KEY must be ${ENCRYPTION_KEY_BYTES} base64-encoded bytes.`,
      ['AI_GATEWAY_ENCRYPTION_KEY'],
    );
  }

  return {
    config: {
      apiKey: parsed.data.AI_GATEWAY_API_KEY,
      encryptionKey,
      dataDir: parsed.data.AI_GATEWAY_DATA_DIR,
      refreshIntervalSeconds: parsed.data.AI_GATEWAY_REFRESH_INTERVAL_SECONDS,
      usageMinIntervalSeconds:
        parsed.data.AI_GATEWAY_USAGE_MIN_INTERVAL_SECONDS,
      tokenRefreshSkewSeconds:
        parsed.data.AI_GATEWAY_TOKEN_REFRESH_SKEW_SECONDS,
      claudeCodeVersion: parsed.data.AI_GATEWAY_CLAUDE_CODE_VERSION,
      anthropicClientId: parsed.data.AI_GATEWAY_ANTHROPIC_CLIENT_ID,
      openAiClientId: parsed.data.AI_GATEWAY_OPENAI_CLIENT_ID,
    },
    generated,
  };
}

/** Print generated development secrets once, so the panel is reachable. */
export function reportGeneratedSecrets(
  generated: readonly { name: SecretName; value: string }[],
): void {
  if (generated.length === 0) return;
  const lines = generated.map(({ name, value }) => `  ${name}=${value}`);
  console.warn(
    [
      '[ai-gateway] development secrets generated for this process only.',
      '[ai-gateway] Put them in your environment to keep them across restarts:',
      ...lines,
    ].join('\n'),
  );
}
