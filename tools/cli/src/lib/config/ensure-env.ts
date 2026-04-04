import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import * as logger from '../../utils/logger';
import { deriveAgePublicKey, generateAgeKeypair } from '../crypto/age-keygen';

function listTaleVolumes(): string[] {
  try {
    const result = execSync('docker volume ls --filter name=tale-dev -q', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return result.trim().split('\n').filter(Boolean);
  } catch (err) {
    logger.debug(`Failed to list Docker volumes: ${err}`);
    return [];
  }
}

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
  openrouterKey?: string;
}

export async function ensureEnv(
  options: EnvSetupOptions,
): Promise<EnvSetupResult> {
  const envPath = join(options.deployDir, '.env');

  if (existsSync(envPath)) {
    // Parse existing .env and check for missing required variables
    const content = await readFile(envPath, 'utf-8');
    const existing = parseEnvFile(content);

    const requiredVars = [
      'HOST',
      'SITE_URL',
      'TLS_MODE',
      'BETTER_AUTH_SECRET',
      'ENCRYPTION_SECRET_HEX',
      'INSTANCE_SECRET',
      'DB_PASSWORD',
      'SOPS_AGE_KEY',
    ];
    const missing = requiredVars.filter((v) => !existing[v]);

    if (missing.length === 0) {
      // All required vars present — derive public key for caller
      const agePublicKey = deriveAgePublicKey(existing.SOPS_AGE_KEY);
      return { success: true, agePublicKey };
    }

    if (!isTTY) {
      logger.warn(
        `Existing .env is missing required variables: ${missing.join(', ')}`,
      );
      logger.info('Run the CLI interactively to complete environment setup.');
      return { success: false };
    }

    // Fill in only the missing variables
    return await runPartialEnvSetup(envPath, existing, missing);
  }

  if (!isTTY) {
    logger.error('Environment file not found');
    logger.blank();
    logger.info(`Expected location: ${envPath}`);
    logger.blank();
    logger.info('Run the CLI interactively to set up your environment,');
    logger.info('or create the .env file manually.');
    return { success: false };
  }

  return await runEnvSetup(envPath);
}

/**
 * Fill in missing variables in an existing .env file.
 */
async function runPartialEnvSetup(
  envPath: string,
  existing: Record<string, string>,
  missing: string[],
): Promise<EnvSetupResult> {
  const { input, password, select } = await import('@inquirer/prompts');

  logger.blank();
  logger.header('Environment Setup (partial)');
  logger.info('Existing .env found — filling in missing variables.');
  logger.blank();

  const updates: Record<string, string> = {};
  let openrouterKey: string | undefined;

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

  // OpenRouter API key (prompt if no secrets file exists)
  const secretsPath = join(
    dirname(envPath),
    'providers',
    'openrouter.secrets.json',
  );
  if (!existsSync(secretsPath)) {
    logger.blank();
    logger.header('API Configuration');
    openrouterKey = await password({
      message: 'Enter your OpenRouter API key (from https://openrouter.ai):',
      mask: '*',
      validate: (v) => {
        if (!v.trim()) return 'OpenRouter API key is required';
        return true;
      },
    });
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
  return { success: true, agePublicKey, openrouterKey };
}

async function runEnvSetup(envPath: string): Promise<EnvSetupResult> {
  const { input, password, select } = await import('@inquirer/prompts');

  const existingVolumes = listTaleVolumes();

  if (existingVolumes.length > 0) {
    const { confirm } = await import('@inquirer/prompts');
    logger.blank();
    logger.warn(`Found ${existingVolumes.length} existing Tale dev volume(s):`);
    for (const v of existingVolumes) {
      logger.info(`  - ${v}`);
    }
    const shouldRemove = await confirm({
      message: 'Remove all Tale dev volumes and start fresh?',
      default: true,
    });
    if (!shouldRemove) {
      logger.error(
        'Cannot continue with existing volumes. Run "tale init" again after removing manually:',
      );
      logger.info('  docker volume rm ' + existingVolumes.join(' '));
      return { success: false };
    }
    logger.step('Stopping Tale containers...');
    try {
      execSync('docker compose -p tale-dev down --remove-orphans', {
        stdio: 'ignore',
      });
    } catch (err) {
      logger.debug(`Failed to stop tale-dev containers: ${err}`);
    }

    for (const v of existingVolumes) {
      execSync(`docker volume rm ${v}`, { stdio: 'ignore' });
    }
    logger.success(`Removed ${existingVolumes.length} Tale dev volume(s).`);
  }

  logger.blank();
  logger.header('Environment Setup');
  logger.info("Let's configure your deployment environment.");
  logger.blank();

  const host = await input({
    message: 'Enter your domain (without protocol):',
    default: 'localhost',
    validate: (value) => {
      if (!value.trim()) {
        return 'Domain cannot be empty';
      }
      if (value.includes('://')) {
        return 'Enter domain only, without protocol (e.g., demo.tale.dev)';
      }
      return true;
    },
  });

  const siteUrl = `https://${host}`;

  const tlsMode = await select({
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

  let tlsEmail = '';
  if (tlsMode === 'letsencrypt') {
    tlsEmail = await input({
      message: "Enter email for Let's Encrypt notifications:",
      validate: (value) => {
        if (!value.trim()) {
          return "Email is required for Let's Encrypt";
        }
        if (!value.includes('@')) {
          return 'Please enter a valid email address';
        }
        return true;
      },
    });
  }

  logger.blank();
  logger.header('API Configuration');

  const openrouterKey = await password({
    message: 'Enter your OpenRouter API key (from https://openrouter.ai):',
    mask: '*',
    validate: (value) => {
      if (!value.trim()) {
        return 'OpenRouter API key is required';
      }
      return true;
    },
  });

  logger.blank();
  logger.step('Generating security secrets...');

  const dbPassword = generatePassword();
  logger.info('Generated new database password.');

  const ageKeypair = generateAgeKeypair();
  logger.info('Generated age encryption keypair for provider secrets.');

  const secrets = {
    betterAuthSecret: generateBase64Secret(),
    encryptionSecretHex: generateHexSecret(),
    instanceSecret: generateHexSecret(),
    dbPassword,
    sopsAgeKey: ageKeypair.secretKey,
  };

  const envContent = generateEnvContent({
    host,
    siteUrl,
    tlsMode,
    tlsEmail,
    ...secrets,
  });

  await writeFile(envPath, envContent, 'utf-8');

  logger.blank();
  logger.success('Environment file created!');
  logger.info(`Location: ${envPath}`);
  logger.blank();
  logger.info('Generated secrets have been configured automatically.');
  logger.info('You can modify the .env file later to customize settings.');
  logger.blank();

  return { success: true, agePublicKey: ageKeypair.publicKey, openrouterKey };
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
    '# Provider Secrets Encryption (age/SOPS)',
    '# ============================================================================',
    `SOPS_AGE_KEY=${config.sopsAgeKey}`,
    '',
  );

  return lines.join('\n');
}
