import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import * as logger from '../../utils/logger';
import { deriveAgePublicKey, generateAgeKeypair } from '../crypto/age-keygen';

const isTTY = process.stdin.isTTY && process.stdout.isTTY;

function generateBase64Secret(): string {
  return randomBytes(32).toString('base64');
}

function generateHexSecret(): string {
  return randomBytes(32).toString('hex');
}

function generatePassword(): string {
  return randomBytes(16).toString('base64url');
}

/**
 * Internal TLS-derivation discriminator. `trial` = the local default written
 * by `tale init`; `production` = a real domain chosen at `tale deploy`.
 */
type DeployMode = 'trial' | 'production';

interface DomainTlsConfig {
  mode: DeployMode;
  host: string;
  siteUrl: string;
  tlsMode: 'selfsigned' | 'letsencrypt';
  tlsEmail: string;
}

/**
 * A hostname that can never receive a public Let's Encrypt certificate:
 * loopback, `*.local`/`*.localhost`, or a bare IP. Used to downgrade a
 * "production" choice to self-signed instead of failing the ACME challenge.
 */
export function isLocalHostname(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || h === '::1') return true;
  if (h.endsWith('.local') || h.endsWith('.localhost')) return true;
  // IPv4 (any address — public certs are issued for names, not IPs).
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  // Bare IPv6 literal (optionally bracketed), e.g. `[::1]`, `fe80::1`,
  // `2001:db8::1`. Like IPv4, a public CA never issues for an IP literal, so
  // letsencrypt would fail the ACME challenge — treat it as local.
  const v6 = h.replace(/^\[|\]$/g, '');
  if (v6.includes(':') && /^[0-9a-f:]+$/.test(v6)) return true;
  return false;
}

/**
 * Pure derivation of the domain + TLS settings from the chosen mode. Both
 * `tale init` and CI flag-driven setup route through this so the `.env` is
 * identical regardless of how the inputs were collected. Production against a
 * local host is automatically downgraded to self-signed (footgun guard).
 */
export function deriveDomainTls(input: {
  mode: DeployMode;
  host?: string;
  email?: string;
}): DomainTlsConfig {
  if (input.mode === 'trial') {
    return {
      mode: 'trial',
      host: 'localhost',
      siteUrl: 'https://localhost',
      tlsMode: 'selfsigned',
      tlsEmail: '',
    };
  }
  const host = (input.host ?? '').trim();
  if (isLocalHostname(host)) {
    return {
      mode: 'production',
      host,
      siteUrl: `https://${host}`,
      tlsMode: 'selfsigned',
      tlsEmail: '',
    };
  }
  return {
    mode: 'production',
    host,
    siteUrl: `https://${host}`,
    tlsMode: 'letsencrypt',
    tlsEmail: input.email ?? '',
  };
}

/** Parse a .env file into a key-value map (ignores comments and blank lines). */
function parseEnvFile(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (key) env[key] = value;
  }
  return env;
}

interface EnvSetupOptions {
  deployDir: string;
}

interface EnvSetupResult {
  success: boolean;
  agePublicKey?: string;
  /**
   * Set when `ensureEnv` filled in missing auto-gen secrets (most relevant:
   * `SANDBOX_TOKEN`) — so the deploy action can force-recreate the
   * containers that depend on those secrets. Without forced recreate, a
   * container that's already running on an unchanged image keeps its
   * pre-rotation env in memory while peers pick up the new one, breaking
   * the HMAC handshake until the next manual restart.
   */
  regeneratedAutoSecrets?: readonly string[];
}

/**
 * Prompt for the production domain + Let's Encrypt email. There is no "trial
 * vs production" question — running `tale deploy` *is* the production choice.
 * A local-looking host downgrades to self-signed automatically.
 */
async function promptProductionDomain(): Promise<DomainTlsConfig> {
  const { input } = await import('../../utils/prompt');
  const host = await input({
    message: 'Domain to deploy to (without protocol):',
    validate: (value) => {
      if (!value.trim()) return 'Domain cannot be empty';
      if (value.includes('://'))
        return 'Enter domain only, without protocol (e.g., demo.tale.dev)';
      return true;
    },
  });

  if (isLocalHostname(host)) {
    logger.notice(
      "That's a local address — using a self-signed certificate (Let's Encrypt needs a public domain).",
    );
    return deriveDomainTls({ mode: 'production', host });
  }

  const email = await input({
    message: "Email for Let's Encrypt notifications:",
    validate: (value) => {
      if (!value.trim()) return "Email is required for Let's Encrypt";
      if (!value.includes('@')) return 'Please enter a valid email address';
      return true;
    },
  });
  return deriveDomainTls({ mode: 'production', host, email });
}

/**
 * Set (update or append) plain `KEY=value` pairs in `<deployDir>/.env`,
 * preserving everything else. For non-secret operator toggles like
 * SANDBOX_DOCKER_IN_CONTAINER that `tale init` writes from a prompt. No-op if
 * the .env doesn't exist yet (ensureEnv creates it first).
 */
export async function setEnvVars(
  deployDir: string,
  updates: Record<string, string>,
): Promise<void> {
  const envPath = join(deployDir, '.env');
  let existing: Record<string, string>;
  try {
    existing = parseEnvFile(await readFile(envPath, 'utf-8'));
  } catch {
    return; // no .env — nothing to update
  }
  await applyEnvUpdates(envPath, existing, updates);
}

/** Update or append `KEY=value` lines in an .env file, preserving the rest. */
async function applyEnvUpdates(
  envPath: string,
  existing: Record<string, string>,
  updates: Record<string, string>,
): Promise<void> {
  let content = await readFile(envPath, 'utf-8');
  for (const [key, value] of Object.entries(updates)) {
    const line = `${key}=${value}`;
    if (existing[key] !== undefined) {
      content = content.replace(new RegExp(`^${key}=.*$`, 'm'), line);
    } else {
      content = `${content.endsWith('\n') ? content : `${content}\n`}${line}\n`;
    }
  }
  await writeFile(envPath, content, 'utf-8');
}

/**
 * One-release migration shim for the `LLM_GATEWAY_*` → `SANDBOX_LLM_GATEWAY_*`
 * env rename (landed with the `llm-gateway` → `sandbox-llm-gateway` service
 * rename). On an upgrade an existing `.env` still carries the old names; copy
 * each old value to its new name when the new name isn't already set, so the
 * auto-secret-fill below doesn't mistake the renamed
 * `SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD` for a brand-new required secret and
 * regenerate it — which would silently rotate the gateway admin credential and
 * lock the platform out of an already-provisioned gateway. The old keys are left
 * in place; the backend reads the new name first and falls back to the old for
 * the same transition window. Mutates `existing` so the missing-var computation
 * that follows sees the migrated keys as present.
 */
async function migrateRenamedEnvVars(
  envPath: string,
  existing: Record<string, string>,
): Promise<void> {
  const OLD_PREFIX = 'LLM_GATEWAY_';
  const NEW_PREFIX = 'SANDBOX_LLM_GATEWAY_';
  const updates: Record<string, string> = {};
  for (const [key, value] of Object.entries(existing)) {
    if (!key.startsWith(OLD_PREFIX)) continue;
    const renamed = `${NEW_PREFIX}${key.slice(OLD_PREFIX.length)}`;
    if (existing[renamed] === undefined) updates[renamed] = value;
  }
  if (Object.keys(updates).length === 0) return;
  await applyEnvUpdates(envPath, existing, updates);
  Object.assign(existing, updates);
  logger.info(
    `Migrated ${Object.keys(updates).length} gateway env var(s) to the SANDBOX_LLM_GATEWAY_* prefix.`,
  );
}

/**
 * Configure the production domain + TLS ahead of a deploy. `tale init` leaves a
 * local default (localhost + self-signed); deploy is where a real domain is
 * picked. Non-interactive with `--host` or when HOST is already public;
 * otherwise it prompts. On a non-TTY run with no `--host` and a still-local
 * HOST it is a no-op — deploy-preflight then validates the result.
 */
export async function ensureProductionDomain(
  deployDir: string,
  opts: { host?: string } = {},
): Promise<void> {
  const envPath = join(deployDir, '.env');
  if (!existsSync(envPath)) return;
  const existing = parseEnvFile(await readFile(envPath, 'utf-8'));
  const currentHost = (existing.HOST ?? '').trim();

  let config: DomainTlsConfig | undefined;
  const flagHost = opts.host?.trim();
  if (flagHost) {
    config = deriveDomainTls({ mode: 'production', host: flagHost });
  } else if (!isLocalHostname(currentHost)) {
    return; // HOST already points at a public domain — keep it.
  } else if (isTTY) {
    config = await promptProductionDomain();
  } else {
    return; // Non-interactive with nothing to go on — keep the local default.
  }

  if (isLocalHostname(config.host)) return; // local host → keep local default

  await applyEnvUpdates(envPath, existing, {
    HOST: config.host,
    SITE_URL: config.siteUrl,
    TLS_MODE: config.tlsMode,
    ...(config.tlsEmail ? { TLS_EMAIL: config.tlsEmail } : {}),
  });
  logger.success(
    `Production domain configured: ${config.host} (${config.tlsMode}).`,
  );
}

export async function ensureEnv(
  options: EnvSetupOptions,
): Promise<EnvSetupResult> {
  const envPath = join(options.deployDir, '.env');

  if (existsSync(envPath)) {
    // Parse existing .env and check for missing required variables
    const content = await readFile(envPath, 'utf-8');
    const existing = parseEnvFile(content);

    // Carry forward any renamed vars before computing what's "missing", so a
    // rename isn't mistaken for a fresh required secret and regenerated.
    await migrateRenamedEnvVars(envPath, existing);

    // Split required vars by who can satisfy them:
    //   - User-supplied: needs human input (HOST, TLS choice). Non-TTY
    //     upgrade can't fill these in; refuse and prompt for interactive.
    //   - Auto-generatable: secret of a known shape (HMAC keys, DB password,
    //     age key). Non-TTY upgrade silently fills these so headless
    //     CI/CD deploys keep working when the schema gains a new secret
    //     (history: `SANDBOX_TOKEN` was added to required mid-stream and
    //     started failing every existing headless deploy).
    const requiredUserVars = ['HOST', 'SITE_URL', 'TLS_MODE'];
    const requiredAutoVars = [
      'BETTER_AUTH_SECRET',
      'ENCRYPTION_SECRET_HEX',
      'INSTANCE_SECRET',
      'DB_PASSWORD',
      'SOPS_AGE_KEY',
      // Shared HMAC secret for the backend → sandbox spawner. Generated as
      // 32 random bytes (hex); see services/sandbox/src/auth.ts.
      'SANDBOX_TOKEN',
      // HMAC key that signs audit-log retention/scrub checkpoints, making the
      // hash chain tamper-evident (SOC 2 / ISO 27001). Auto-generated so the
      // control is ON by default and STABLE across deploys — a missing or
      // changing key is what makes the daily integrity cron raise a scary
      // "Audit log integrity check failed" alert on an otherwise-clean stack.
      // See services/platform/backend/domains/audit_logs/.
      'TALE_AUDIT_SIGNING_KEY',
      // Admin password for the sandbox LLM gateway's management API (the platform
      // pushes provider keys / mints virtual keys through it). Auto-generated
      // so the gateway is locked by default and the credential is STABLE
      // across deploys; the matching SANDBOX_LLM_GATEWAY_ADMIN_USERNAME=admin is a
      // static line written by generateEnvContent.
      'SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD',
      // Root credential for the bundled object store — the deployment's blob
      // backend, and the only one there is (S3-compatible storage replaced
      // Convex `_storage`). Auto-generated so uploads work out of the box and
      // the credential is STABLE across deploys: rotating it would orphan
      // every blob already written under the old key.
      'OBJECT_STORE_SECRET_KEY',
    ];
    const missingUser = requiredUserVars.filter((v) => !existing[v]);
    const missingAuto = requiredAutoVars.filter((v) => !existing[v]);

    let result: EnvSetupResult;

    if (missingUser.length === 0 && missingAuto.length === 0) {
      // All required vars present — derive public key for caller
      const agePublicKey = deriveAgePublicKey(existing.SOPS_AGE_KEY);
      result = { success: true, agePublicKey };
    } else if (!isTTY) {
      // Headless: refuse only when user-supplied vars are missing (we
      // can't synthesize a domain or TLS choice). Otherwise auto-generate
      // the missing secrets and continue so CI/CD upgrades stay green.
      if (missingUser.length > 0) {
        logger.warn(
          `Existing .env is missing required user-supplied variables: ${missingUser.join(', ')}`,
        );
        logger.info('Run the CLI interactively to complete environment setup.');
        return { success: false };
      }
      result = await runHeadlessAutoSecretFill(envPath, existing, missingAuto);
    } else {
      // Fill in only the missing variables
      result = await runPartialEnvSetup(envPath, existing, [
        ...missingUser,
        ...missingAuto,
      ]);
    }

    return result;
  }

  // No .env yet — write the local default. Non-interactive (no prompts, no
  // Docker), so this works the same in a terminal and in CI.
  return await runEnvSetup(envPath);
}

/**
 * Headless (non-TTY) auto-gen path for known-shape secrets. Used when a
 * deploy adds a new required secret (e.g. `SANDBOX_TOKEN`) and existing
 * CI/CD deploys would otherwise fail because the secret isn't in their
 * `.env`. Only invoked when every missing var is in the auto-gen set; a
 * missing user-supplied var (HOST, TLS_MODE) still refuses non-TTY.
 *
 * The deploy action receives `regeneratedAutoSecrets` so it can
 * force-recreate containers that read these secrets at boot (otherwise
 * a container already running on an unchanged image keeps the old null
 * value while its peer picks up the new one — HMAC handshake breaks).
 */
async function runHeadlessAutoSecretFill(
  envPath: string,
  existing: Record<string, string>,
  missingAuto: string[],
): Promise<EnvSetupResult> {
  const secretDefaults: Record<string, () => string> = {
    BETTER_AUTH_SECRET: generateBase64Secret,
    ENCRYPTION_SECRET_HEX: generateHexSecret,
    INSTANCE_SECRET: generateHexSecret,
    DB_PASSWORD: generatePassword,
    SANDBOX_TOKEN: generateHexSecret,
    TALE_AUDIT_SIGNING_KEY: generateHexSecret,
    SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD: generatePassword,
    OBJECT_STORE_SECRET_KEY: generatePassword,
  };

  const updates: Record<string, string> = {};
  let sopsAgeKey = existing.SOPS_AGE_KEY;

  for (const key of missingAuto) {
    if (key === 'SOPS_AGE_KEY') {
      const keypair = generateAgeKeypair();
      updates.SOPS_AGE_KEY = keypair.secretKey;
      sopsAgeKey = keypair.secretKey;
      continue;
    }
    const generator = secretDefaults[key];
    if (generator === undefined) {
      // Defensive: a var made it into requiredAutoVars without a
      // generator. Refuse rather than silently leave it unset.
      logger.error(
        `[ensureEnv] Missing auto-secret generator for "${key}". Add one in runHeadlessAutoSecretFill.`,
      );
      return { success: false };
    }
    updates[key] = generator();
  }

  // Surgically append to preserve existing content + comments.
  const existingContent = await readFile(envPath, 'utf-8');
  const appendLines = Object.entries(updates).map(([k, v]) => `${k}=${v}`);
  if (appendLines.length > 0) {
    const separator = existingContent.endsWith('\n') ? '' : '\n';
    await writeFile(
      envPath,
      existingContent + separator + appendLines.join('\n') + '\n',
      'utf-8',
    );
    logger.info(
      `[ensureEnv] Generated ${missingAuto.length} missing secret(s) headlessly: ${missingAuto.join(', ')}.`,
    );
  }

  const agePublicKey = deriveAgePublicKey(sopsAgeKey);
  return {
    success: true,
    agePublicKey,
    regeneratedAutoSecrets: missingAuto,
  };
}

/**
 * Fill in missing variables in an existing .env file.
 */
async function runPartialEnvSetup(
  envPath: string,
  existing: Record<string, string>,
  missing: string[],
): Promise<EnvSetupResult> {
  const { input, select } = await import('../../utils/prompt');

  logger.blank();
  logger.header('Environment Setup (partial)');
  logger.info('Existing .env found — filling in missing variables.');
  logger.blank();

  const updates: Record<string, string> = {};

  // Domain configuration
  if (missing.includes('HOST')) {
    updates.HOST = await input({
      message: 'Enter your domain (without protocol):',
      default: 'localhost',
      validate: (v) => {
        if (!v.trim()) return 'Domain cannot be empty';
        if (v.includes('://'))
          return 'Enter domain only, without protocol (e.g., demo.tale.dev)';
        return true;
      },
    });
    updates.SITE_URL = `https://${updates.HOST}`;
  } else {
    logger.info(`Using existing HOST=${existing.HOST}`);
    if (missing.includes('SITE_URL')) {
      updates.SITE_URL = `https://${existing.HOST}`;
    }
  }

  // TLS configuration
  if (missing.includes('TLS_MODE')) {
    updates.TLS_MODE = await select({
      message: 'Select TLS/SSL mode:',
      choices: [
        {
          name: 'selfsigned (development)',
          value: 'selfsigned',
          description: 'Self-signed certificates, browser will show warning',
        },
        {
          name: 'letsencrypt (production)',
          value: 'letsencrypt',
          description: 'Free trusted certificates, requires public domain',
        },
      ],
      default: 'selfsigned',
    });
    if (updates.TLS_MODE === 'letsencrypt' && !existing.TLS_EMAIL) {
      updates.TLS_EMAIL = await input({
        message: "Enter email for Let's Encrypt notifications:",
        validate: (v) => {
          if (!v.trim()) return "Email is required for Let's Encrypt";
          if (!v.includes('@')) return 'Please enter a valid email address';
          return true;
        },
      });
    }
  } else {
    logger.info(`Using existing TLS_MODE=${existing.TLS_MODE}`);
  }

  // Auto-generate missing secrets
  const secretDefaults: Record<string, () => string> = {
    BETTER_AUTH_SECRET: generateBase64Secret,
    ENCRYPTION_SECRET_HEX: generateHexSecret,
    INSTANCE_SECRET: generateHexSecret,
    DB_PASSWORD: generatePassword,
    SANDBOX_TOKEN: generateHexSecret,
    TALE_AUDIT_SIGNING_KEY: generateHexSecret,
    SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD: generatePassword,
    OBJECT_STORE_SECRET_KEY: generatePassword,
  };

  let generatedCount = 0;
  for (const [key, generator] of Object.entries(secretDefaults)) {
    if (missing.includes(key)) {
      updates[key] = generator();
      generatedCount++;
    }
  }
  if (generatedCount > 0) {
    logger.info(`Generated ${generatedCount} missing secret(s).`);
  }

  // SOPS age key
  let sopsAgeKey = existing.SOPS_AGE_KEY;
  if (missing.includes('SOPS_AGE_KEY')) {
    const keypair = generateAgeKeypair();
    updates.SOPS_AGE_KEY = keypair.secretKey;
    sopsAgeKey = keypair.secretKey;
    logger.info('Generated age encryption keypair for provider secrets.');
  }

  // Surgically append missing variables to the existing .env (preserves all original content)
  const existingContent = await readFile(envPath, 'utf-8');
  const appendLines: string[] = [];
  for (const [key, value] of Object.entries(updates)) {
    appendLines.push(`${key}=${value}`);
  }
  if (appendLines.length > 0) {
    const separator = existingContent.endsWith('\n') ? '' : '\n';
    await writeFile(
      envPath,
      existingContent + separator + appendLines.join('\n') + '\n',
      'utf-8',
    );
  }

  logger.blank();
  logger.success('Environment file updated!');
  logger.blank();

  const agePublicKey = deriveAgePublicKey(sopsAgeKey);
  return { success: true, agePublicKey };
}

async function runEnvSetup(envPath: string): Promise<EnvSetupResult> {
  // `tale init` produces a local-by-default environment — localhost with a
  // self-signed certificate and freshly generated secrets. No prompts and no
  // Docker contact: the production domain + TLS are chosen later, at
  // `tale deploy`.
  const { host, siteUrl, tlsMode, tlsEmail } = deriveDomainTls({
    mode: 'trial',
  });

  logger.step('Generating security secrets...');
  const ageKeypair = generateAgeKeypair();

  const envContent = generateEnvContent({
    host,
    siteUrl,
    tlsMode,
    tlsEmail,
    betterAuthSecret: generateBase64Secret(),
    encryptionSecretHex: generateHexSecret(),
    instanceSecret: generateHexSecret(),
    dbPassword: generatePassword(),
    sopsAgeKey: ageKeypair.secretKey,
    sandboxToken: generateHexSecret(),
    auditSigningKey: generateHexSecret(),
    llmGatewayAdminPassword: generatePassword(),
    objectStoreSecretKey: generatePassword(),
  });

  await writeFile(envPath, envContent, 'utf-8');
  logger.success(
    'Environment configured (local defaults: localhost, self-signed TLS).',
  );

  return { success: true, agePublicKey: ageKeypair.publicKey };
}

interface EnvConfig {
  host: string;
  siteUrl: string;
  tlsMode: string;
  tlsEmail: string;
  betterAuthSecret: string;
  encryptionSecretHex: string;
  instanceSecret: string;
  dbPassword: string;
  sopsAgeKey: string;
  sandboxToken: string;
  auditSigningKey: string;
  llmGatewayAdminPassword: string;
  objectStoreSecretKey: string;
}

function generateEnvContent(config: EnvConfig): string {
  const lines: string[] = [
    '# ============================================================================',
    '# Tale Platform - Environment Configuration',
    '# ============================================================================',
    `# Generated by Tale CLI on ${new Date().toISOString()}`,
    '',
    '# ============================================================================',
    '# Domain Configuration',
    '# ============================================================================',
    `HOST=${config.host}`,
    `SITE_URL=${config.siteUrl}`,
    '',
    '# ============================================================================',
    '# TLS/SSL Configuration',
    '# ============================================================================',
    `TLS_MODE=${config.tlsMode}`,
  ];

  if (config.tlsEmail) {
    lines.push(`TLS_EMAIL=${config.tlsEmail}`);
  }

  lines.push(
    '',
    '# ============================================================================',
    '# Security Secrets (auto-generated)',
    '# ============================================================================',
    `BETTER_AUTH_SECRET=${config.betterAuthSecret}`,
    '# 32-byte hex key. Direct AES-256 key for OAuth/connector credentials',
    '# in DB; HKDF input for the guardrails secret-box. Rotation invalidates',
    '# DB-stored ciphertexts — affected secrets must be re-entered.',
    `ENCRYPTION_SECRET_HEX=${config.encryptionSecretHex}`,
    `INSTANCE_SECRET=${config.instanceSecret}`,
    '',
    '# ============================================================================',
    '# Database Configuration',
    '# ============================================================================',
    '# WARNING: PostgreSQL only reads this on FIRST initialization.',
    '# Changing this after the database exists requires manual SQL update.',
    `DB_PASSWORD=${config.dbPassword}`,
    '',
    '# ============================================================================',
    '# Provider Secrets Encryption (SOPS + age)',
    '# ============================================================================',
    '# Controls how provider API key files (providers/*.secrets.json) are stored.',
    '# `tale init` provisions SOPS_AGE_KEY (encrypted mode is the default); the',
    '# other two modes below are reachable via post-init .env edits.',
    '#   - SOPS_AGE_KEY set       → files written SOPS-encrypted (default).',
    '#                              Inline form does NOT support multiple keys —',
    '#                              switch to SOPS_AGE_KEY_FILE for rotation.',
    '#   - SOPS_AGE_KEY_FILE set  → one or more keys per file, Vault / K8s',
    '#                              Secret / systemd LoadCredential supported.',
    '#                              Append a new key + re-save each provider in',
    '#                              Settings → AI providers to rotate; remove',
    '#                              the old key after re-saves complete.',
    '#   - Both unset             → plaintext JSON at mode 0600. Reach this by',
    '#                              clearing SOPS_AGE_KEY here post-init and',
    '#                              re-saving via Settings → AI providers. Use',
    '#                              only if disk is encrypted at rest, or you',
    '#                              provision the *.secrets.json files via',
    '#                              external tooling.',
    `SOPS_AGE_KEY=${config.sopsAgeKey}`,
    '# SOPS_AGE_KEY_FILE=',
    '',
    '# ============================================================================',
    '# Sandbox (artifact_run) Configuration',
    '# ============================================================================',
    '# Shared HMAC secret. The backend signs every request to the spawner',
    '# with this; the spawner rejects unsigned/wrong-signed requests. Rotate',
    '# by setting a new value and restarting both `platform` and `sandbox`.',
    `SANDBOX_TOKEN=${config.sandboxToken}`,
    '# Where the backend (api + worker) reaches the sandbox spawner. The',
    '# session_client host-dev default is http://localhost:8003; a container',
    '# worker without this hits that default and every agent run dies with',
    '# "fetch failed". Compose and the entrypoint also default this.',
    'SANDBOX_URL=http://sandbox:8003',
    '# Live browser view (read-only mirror in the chat UI). Default ON. The',
    '# spawner launches session containers with a headed Chromium + x11vnc mirror',
    '# (TALE_BROWSER_CDP) and the platform attaches Playwright MCP over CDP, so',
    "# the agent's browser is streamed read-only into the web page.",
    '# The sandbox spawner is the only reader. Set to 0 to opt out — the agent',
    '# then uses a headless browser, just with no live preview.',
    '# SANDBOX_BROWSER_VIEW=0',
    '',
    '# ============================================================================',
    '# Audit Log Signing (security / compliance)',
    '# ============================================================================',
    '# HMAC-SHA256 key that signs audit-log retention & PII-scrub checkpoints so',
    '# the audit hash chain is tamper-evident (SOC 2 CC7.2, ISO 27001). The daily',
    '# integrity cron verifies these signatures; a MISSING or CHANGED key is what',
    '# surfaces the "Audit log integrity check failed" alert — so this is',
    '# auto-generated and must stay STABLE across deploys.',
    '#   - Back it up with your other secrets (secret manager / Vault). Losing it',
    '#     means checkpoints signed with it can no longer be verified.',
    '#   - To ROTATE: move the current value to TALE_AUDIT_SIGNING_KEY_PREVIOUS,',
    '#     set a fresh TALE_AUDIT_SIGNING_KEY (openssl rand -hex 32), redeploy.',
    '#     The verifier accepts both during the rotation window; drop the',
    '#     previous key on the next rotation.',
    `TALE_AUDIT_SIGNING_KEY=${config.auditSigningKey}`,
    '# TALE_AUDIT_SIGNING_KEY_PREVIOUS=',
    '',
    '# ============================================================================',
    '# Sandbox LLM Gateway (model-routing proxy for in-sandbox coding agents)',
    '# ============================================================================',
    '# Admin credentials for the sandbox LLM gateway management API. The platform',
    '# uses these to push provider keys and mint per-session virtual keys. The',
    '# username is fixed; the password is auto-generated and must stay STABLE',
    '# across deploys (a changed password locks the platform out of the gateway).',
    'SANDBOX_LLM_GATEWAY_ADMIN_USERNAME=admin',
    `SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD=${config.llmGatewayAdminPassword}`,
    '',
    '# ============================================================================',
    "# Object store (the deployment's blob backend)",
    '# ============================================================================',
    '# Uploaded documents, chat attachments, audio and generated media live in',
    '# the bundled S3-compatible store — it is the ONLY blob backend, so a',
    '# deployment without it refuses every upload. An organization can point its',
    '# own blobs at an external bucket in Settings > Data residency; that is',
    '# resolved BEFORE this default and is unaffected by these values.',
    '#   - The key must stay STABLE across deploys: rotating it orphans every',
    '#     blob already written under the old credential.',
    '#   - OBJECT_STORE_BUCKET defaults to tale-blobs and is created on first boot.',
    'OBJECT_STORE_ACCESS_KEY=tale',
    `OBJECT_STORE_SECRET_KEY=${config.objectStoreSecretKey}`,
    '# OBJECT_STORE_BUCKET=tale-blobs',
    '# Container runtime for spawned sandbox containers. `runc` (default) is',
    '# plain Docker; `runsc` is gVisor (requires `runsc` installed on the',
    '# host and registered with dockerd). gVisor provides',
    '# a userspace kernel that mitigates runc-class escape CVEs at the cost',
    '# of ~6x pip-install latency for native-extension packages.',
    '# SANDBOX_RUNTIME=runc',
    '# Optional egress lockdown for the sandbox proxy. Unset (default): open',
    '# egress — sandboxed code may CONNECT to any public host on :443. The',
    '# IP-layer SSRF firewall (cloud metadata + private ranges) always applies.',
    '# Set to a pipe-separated regex allow-list to switch the proxy to',
    '# default-deny; restart sandbox-egress to apply. Suggested registry-only',
    '# lockdown (pip/npm/uv + git-over-HTTPS/gh):',
    '# SANDBOX_EGRESS_ALLOWLIST=^pypi\\.org$|^files\\.pythonhosted\\.org$|^registry\\.npmjs\\.org$|^objects\\.githubusercontent\\.com$|^codeload\\.github\\.com$|^github\\.com$|^api\\.github\\.com$',
    '',
  );

  return lines.join('\n');
}
