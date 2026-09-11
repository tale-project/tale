import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { generateGatewayAdminPassword } from '../crypto/gateway-password';
import {
  requireRuntime,
  readRegular,
  type ApplyRuntimeOptions,
} from './runtime-model';

export const RUNTIME_SECRET_KEYS = [
  'DB_PASSWORD',
  'BETTER_AUTH_SECRET',
  'ENCRYPTION_SECRET_HEX',
  'INSTANCE_SECRET',
  'TALE_AUDIT_SIGNING_KEY',
  'SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD',
  'SANDBOX_TOKEN',
  'OBJECT_STORE_SECRET_KEY',
  'TALE_AUDIT_PEPPER',
  'TALE_BOOTSTRAP_PASSWORD',
] as const;
const TOP_UP_KEYS = new Set<string>([
  'SANDBOX_TOKEN',
  'OBJECT_STORE_SECRET_KEY',
  'TALE_AUDIT_PEPPER',
  'TALE_BOOTSTRAP_PASSWORD',
]);
const MANAGED_KEYS = new Set<string>([
  ...RUNTIME_SECRET_KEYS,
  'HOST',
  'SITE_URL',
  'TLS_MODE',
  'TLS_EMAIL',
  'VERSION',
  'PULL_POLICY',
  'SANDBOX_URL',
  'PLATFORM_SHARED_CONFIG',
  'SANDBOX_RUNTIME_IMAGE',
  'SANDBOX_BUILDKITD_IMAGE',
  'SANDBOX_BUILDKITD_MIRROR_IMAGE',
]);
const TOPOLOGY_KEYS = new Set([
  'DATABASE_URL',
  'POSTGRES_DB',
  'POSTGRES_USER',
  'APP_DB_NAME',
  'KNOWLEDGE_DB_NAME',
  'BACKEND_UPSTREAM',
  'OBJECT_STORE_UPSTREAM',
  'TALE_BACKEND_URL',
  'OBJECT_STORE_ENDPOINT',
  'OBJECT_STORE_PUBLIC_ENDPOINT',
  'OBJECT_STORE_ACCESS_KEY',
  'OBJECT_STORE_BUCKET',
  'OBJECT_STORE_REGION',
  'OBJECT_STORE_PREFIX',
  'OBJECT_STORE_FORCE_PATH_STYLE',
  'SANDBOX_HTTP_API_BASE_URL',
  'BASE_PATH',
  'ADDITIONAL_SITE_URLS',
  'DOCS_URL',
]);

/** Parse the two known legacy encodings without evaluating shell or Compose. */
export function parseRuntimeEnvironment(
  text: string,
  format: 'secrets' | 'compose',
): Record<string, string> {
  requireRuntime(
    !text.includes('\0'),
    'Runtime environment contains invalid bytes.',
  );
  const values: Record<string, string> = Object.create(null);
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    requireRuntime(
      match && values[match[1]] === undefined,
      'Runtime environment contains an invalid or duplicate assignment.',
    );
    const [, key, raw] = match;
    let value: string;
    if (raw.startsWith("'")) {
      requireRuntime(
        /^'(?:[^']|'\\'')*'$/.test(raw),
        'Runtime environment contains unsupported shell quoting.',
      );
      value = raw.slice(1, -1).replaceAll("'\\''", "'");
    } else if (raw.startsWith('"')) {
      requireRuntime(
        format === 'compose',
        'Persistent secrets use unsupported quoting.',
      );
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        requireRuntime(
          false,
          'Runtime environment contains unsupported quoted text.',
        );
      }
      requireRuntime(
        typeof parsed === 'string',
        'Runtime environment value is not a string.',
      );
      // The legacy renderer writes JSON strings with every $ doubled. A lone
      // $ would need ambient Compose expansion, which adoption must not guess.
      requireRuntime(
        !parsed.replaceAll('$$', '').includes('$'),
        'Runtime environment requires untrusted interpolation.',
      );
      value = parsed.replaceAll('$$', '$');
    } else {
      requireRuntime(
        /^[A-Za-z0-9_./:+@%=,!?-]*$/.test(raw),
        'Runtime environment requires unsupported evaluation.',
      );
      value = raw;
    }
    values[key] = value;
  }
  return values;
}

function newSecret(name: string): string {
  if (name === 'SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD')
    return generateGatewayAdminPassword();
  if (name === 'DB_PASSWORD') return randomBytes(24).toString('hex');
  if (name === 'OBJECT_STORE_SECRET_KEY')
    return randomBytes(16).toString('hex');
  return randomBytes(32).toString(
    name === 'BETTER_AUTH_SECRET' ? 'base64' : 'hex',
  );
}
const composeValue = (value: string): string =>
  JSON.stringify(value).replaceAll('$', () => '$$');

export interface RuntimeEnvironment {
  secrets: string;
  environment: string;
  regeneratedSecrets: string[];
}

export function prepareRuntimeEnvironment(
  options: ApplyRuntimeOptions,
  revision: string,
  existing: boolean,
  generate = true,
): RuntimeEnvironment {
  const secretPath = join(options.stateDirectory, 'secrets.env');
  const envPath = join(options.stateDirectory, 'src', '.env');
  const oldSecrets = existsSync(secretPath)
    ? readRegular(secretPath).toString('utf8')
    : '';
  const oldEnv = existsSync(envPath)
    ? readRegular(envPath).toString('utf8')
    : '';
  requireRuntime(
    !existing || (oldSecrets.length > 0 && oldEnv.length > 0),
    'Existing runtime is missing its persistent secrets or environment.',
  );
  const secrets = parseRuntimeEnvironment(oldSecrets, 'secrets');
  const previous = parseRuntimeEnvironment(oldEnv, 'compose');
  for (const [key, value] of Object.entries(previous)) {
    requireRuntime(
      !TOPOLOGY_KEYS.has(key) || value === '',
      'Existing runtime has an unrecognized topology override.',
    );
    if (
      RUNTIME_SECRET_KEYS.includes(
        key as (typeof RUNTIME_SECRET_KEYS)[number],
      ) &&
      key !== 'TALE_BOOTSTRAP_PASSWORD'
    ) {
      requireRuntime(
        secrets[key] !== undefined && secrets[key] === value,
        'Existing runtime secret stores disagree; refusing credential replacement.',
      );
    }
  }
  requireRuntime(
    previous.TALE_BOOTSTRAP_PASSWORD === undefined,
    'Bootstrap password must not be present in the runtime environment.',
  );
  const generated: string[] = [];
  let secretText = oldSecrets;
  for (const key of RUNTIME_SECRET_KEYS) {
    if (secrets[key] !== undefined) {
      requireRuntime(
        secrets[key].length > 0,
        'Persistent runtime contains an empty secret.',
      );
      continue;
    }
    requireRuntime(
      !existing || TOP_UP_KEYS.has(key),
      'Existing runtime is missing a non-recoverable secret.',
    );
    generated.push(key);
    if (generate) {
      secrets[key] = newSecret(key);
      secretText += `${secretText && !secretText.endsWith('\n') ? '\n' : ''}${key}='${secrets[key]}'\n`;
    }
  }
  const extras = options.environment ?? {};
  for (const [key, value] of Object.entries(extras)) {
    requireRuntime(
      /^[A-Z][A-Z0-9_]*$/.test(key) &&
        !key.startsWith('COMPOSE_') &&
        !MANAGED_KEYS.has(key) &&
        !TOPOLOGY_KEYS.has(key) &&
        typeof value === 'string' &&
        !value.includes('\0'),
      'Managed runtime environment override is not permitted.',
    );
  }
  const origin = new URL(options.origin);
  const environment: Record<string, string> = {
    ...previous,
    ...extras,
    HOST: origin.hostname,
    SITE_URL: options.origin,
    TLS_MODE: options.tlsMode,
    TLS_EMAIL: options.tlsEmail ?? '',
    PULL_POLICY: 'never',
    VERSION: `sha-${revision}`,
    SENTRY_DSN: extras.SENTRY_DSN ?? previous.SENTRY_DSN ?? '',
    SENTRY_ENVIRONMENT: options.name,
    SENTRY_TRACES_SAMPLE_RATE:
      extras.SENTRY_TRACES_SAMPLE_RATE ??
      previous.SENTRY_TRACES_SAMPLE_RATE ??
      '0',
    METRICS_BEARER_TOKEN:
      extras.METRICS_BEARER_TOKEN ?? previous.METRICS_BEARER_TOKEN ?? '',
    SANDBOX_URL: 'http://sandbox:8003',
  };
  for (const key of RUNTIME_SECRET_KEYS) {
    if (key !== 'TALE_BOOTSTRAP_PASSWORD')
      environment[key] = secrets[key] ?? '';
  }
  // Source Compose fixes these to attested images/volumes. Refuse old custom
  // routes instead of silently changing a deployment that used different data.
  for (const key of [
    'PLATFORM_SHARED_CONFIG',
    'SANDBOX_RUNTIME_IMAGE',
    'SANDBOX_BUILDKITD_IMAGE',
    'SANDBOX_BUILDKITD_MIRROR_IMAGE',
  ]) {
    requireRuntime(
      !previous[key],
      'Existing runtime contains an unrecognized managed image or volume override.',
    );
    delete environment[key];
  }
  requireRuntime(
    Object.keys(previous).every((key) => !key.startsWith('COMPOSE_')),
    'Existing runtime contains an ambient Compose override.',
  );
  return {
    secrets: secretText,
    environment: Object.entries(environment)
      .map(([key, value]) => `${key}=${composeValue(value)}\n`)
      .join(''),
    regeneratedSecrets: generated,
  };
}

/** Private native bootstrap input; never include this value in a public receipt. */
export function readBootstrapPassword(stateDirectory: string): string {
  const values = parseRuntimeEnvironment(
    readRegular(join(stateDirectory, 'secrets.env')).toString('utf8'),
    'secrets',
  );
  requireRuntime(
    typeof values.TALE_BOOTSTRAP_PASSWORD === 'string' &&
      values.TALE_BOOTSTRAP_PASSWORD.length > 0,
    'Existing runtime has no native bootstrap credential.',
  );
  return values.TALE_BOOTSTRAP_PASSWORD;
}
