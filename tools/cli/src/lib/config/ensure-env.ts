import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import * as logger from '../../utils/logger';
import { generateAgeKeypair } from '../crypto/age-keygen';

function listTaleVolumes(): string[] {
  try {
    const result = execSync('docker volume ls --filter name=tale -q', {
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

interface EnvSetupOptions {
  deployDir: string;
  skipIfExists?: boolean;
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
    if (options.skipIfExists) {
      return { success: true };
    }
    logger.debug(`Environment file already exists at ${envPath}`);
    return { success: true };
  }

  if (!isTTY) {
    logger.error('Environment file not found');
    logger.blank();
    logger.info(`Expected location: ${envPath}`);
    logger.blank();
    logger.info('Run the CLI interactively to set up your environment,');
    logger.info('or create the .env file manually.');
    logger.blank();
    logger.info('You can copy from .env.example in the project root.');
    return { success: false };
  }

  return await runEnvSetup(envPath);
}

async function runEnvSetup(envPath: string): Promise<EnvSetupResult> {
  const { input, password, select } = await import('@inquirer/prompts');

  const existingVolumes = listTaleVolumes();

  if (existingVolumes.length > 0) {
    const { confirm } = await import('@inquirer/prompts');
    logger.blank();
    logger.warn(`Found ${existingVolumes.length} existing Tale volume(s):`);
    for (const v of existingVolumes) {
      logger.info(`  - ${v}`);
    }
    const shouldRemove = await confirm({
      message: 'Remove all Tale volumes and start fresh?',
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
      execSync('docker compose -p tale down --remove-orphans', {
        stdio: 'ignore',
      });
    } catch (err) {
      logger.debug(`Failed to stop tale containers: ${err}`);
    }
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
    logger.success(`Removed ${existingVolumes.length} Tale volume(s).`);
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
