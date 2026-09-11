import { posix as path } from 'node:path';

import { preconditionError } from '../../utils/fail';
import { valueHash } from '../config/releases/identity';
import { INFERENCE_ADMISSION_FILENAME } from './admission';
import {
  GIB,
  modelIdentity,
  runtimeModelDirectory,
  type InferenceNode,
  type InferenceSpec,
} from './model';

export interface InferenceSecrets {
  adminKey: string;
  serviceKey: string;
  sessionKey: string;
}
export function inferenceApiKey(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9_-]{32,256}$/.test(value))
    throw preconditionError(
      'Inference API keys require 32–256 URL-safe characters from their declared environment variables.',
    );
  return value;
}
export function inferenceSecrets(
  spec: InferenceSpec,
  node: InferenceNode,
  environment: NodeJS.ProcessEnv,
): InferenceSecrets {
  const adminKey = inferenceApiKey(environment[node.adminKey.env]);
  const serviceKey = inferenceApiKey(environment[spec.serviceKey.env]);
  if (adminKey === serviceKey)
    throw preconditionError(
      'Inference requires separate admin and service keys, each 32–256 URL-safe characters, from their declared environment variables.',
    );
  // Derive a domain-separated signing key without persisting another secret
  // reference; rotating the admin key also expires its prior admin sessions.
  return {
    adminKey,
    serviceKey,
    sessionKey: valueHash({
      purpose: 'tale-inference-admin-session',
      organization: spec.organization,
      node: node.key,
      adminKey,
    }),
  };
}
export const secretIdentity = (secrets: InferenceSecrets) => valueHash(secrets);

export function omlxSettings(
  spec: InferenceSpec,
  node: InferenceNode,
  state: string,
  release: string,
  secrets: InferenceSecrets,
  memoryBytes: number,
) {
  const base = path.join(state, 'releases', release);
  const models = spec.models.filter((model) => node.models.includes(model.key));
  return {
    version: '1.0',
    base_path: base,
    server: {
      host: [...new Set(['127.0.0.1', node.address])].join(','),
      port: node.port,
      log_level: 'warning',
      cors_origins: [],
      distributed_inference_enabled: false,
      auto_start_on_launch: false,
    },
    model: {
      model_dirs: models.map((model) => runtimeModelDirectory(state, model)),
      model_fallback: false,
    },
    scheduler: {
      max_concurrent_requests: spec.limits.concurrency,
      embedding_batch_size: 1,
      chunked_prefill: true,
    },
    memory: {
      prefill_memory_guard: true,
      memory_guard_tier: 'custom',
      memory_guard_custom_ceiling_gb:
        (memoryBytes - spec.limits.memoryReserveBytes) / GIB,
      soft_threshold: 0.85,
      hard_threshold: 0.95,
      prefill_safe_zone_ratio: 0.8,
      prefill_min_chunk_tokens: 32,
    },
    cache: {
      enabled: spec.limits.ssdCacheBytes > 0,
      ssd_cache_dir: path.join(state, 'cache', release),
      ssd_cache_max_size: `${Math.max(1, spec.limits.ssdCacheBytes)}B`,
      hot_cache_max_size: `${spec.limits.hotCacheBytes}B`,
      hot_cache_write_through: false,
    },
    auth: {
      api_key: secrets.adminKey,
      secret_key: secrets.sessionKey,
      skip_api_key_verification: false,
      sub_keys: [
        {
          key: secrets.serviceKey,
          name: 'Tale inference',
          created_at: '1970-01-01T00:00:00Z',
        },
      ],
    },
    mcp: { config_path: null, expose_tools: false },
    logging: { log_dir: path.join(state, 'logs'), retention_days: 7 },
  };
}

export function omlxModelSettings(spec: InferenceSpec, node: InferenceNode) {
  return {
    version: '1.0',
    models: Object.fromEntries(
      spec.models
        .filter((model) => node.models.includes(model.key))
        .map((model) => [
          modelIdentity(model),
          {
            model_alias: model.apiModel,
            model_type_override:
              model.capability === 'vision'
                ? 'vlm'
                : model.capability === 'embedding'
                  ? 'embedding'
                  : 'llm',
            max_context_window: model.contextTokens,
            max_tokens: Math.min(4096, Math.floor(model.contextTokens / 4)),
            is_pinned: false,
            is_default: false,
            trust_remote_code: false,
            dflash_enabled: false,
            mtp_enabled: false,
            vlm_mtp_enabled: false,
            specprefill_enabled: false,
            turboquant_kv_enabled: false,
          },
        ]),
    ),
  };
}

function xml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
/** launchd executes argv directly. No shell, credentials, inherited Python
 * overrides, auto-login or root daemon is part of this service definition. */
export function launchAgentPlist(
  node: InferenceNode,
  state: string,
  release: string,
  app: string,
): string {
  const resources = path.join(app, 'Contents/Resources');
  const pythonHome = path.join(resources, 'Python/cpython-3.11');
  const base = path.join(state, 'releases', release);
  const environment = {
    HOME: `/Users/${node.user}`,
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    PYTHONHOME: pythonHome,
    PYTHONPATH: `${resources}:${resources}/Python/framework-mlx-base/lib/python3.11/site-packages`,
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONNOUSERSITE: '1',
    HF_HUB_OFFLINE: '1',
    TRANSFORMERS_OFFLINE: '1',
    OMLX_BASE_PATH: base,
    WEB_CONCURRENCY: '1',
    MallocSpaceEfficient: '1',
  };
  const args = [
    path.join(pythonHome, 'bin/python3'),
    '-s',
    path.join(base, INFERENCE_ADMISSION_FILENAME),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>dev.tale.inference.${xml(node.key)}</string><key>ProgramArguments</key><array>${args.map((arg) => `<string>${xml(arg)}</string>`).join('')}</array><key>EnvironmentVariables</key><dict>${Object.entries(
    environment,
  )
    .map(
      ([key, value]) => `<key>${xml(key)}</key><string>${xml(value)}</string>`,
    )
    .join(
      '',
    )}</dict><key>WorkingDirectory</key><string>${xml(base)}</string><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>30</integer><key>StandardOutPath</key><string>/dev/null</string><key>StandardErrorPath</key><string>/dev/null</string><key>Umask</key><integer>63</integer></dict></plist>\n`;
}

/** Upstream may materialize its defaults; all explicitly requested security,
 * path and resource values must still match their recorded projection. */
export function containsSettings(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      JSON.stringify(actual) === JSON.stringify(expected)
    );
  if (expected !== null && typeof expected === 'object')
    return (
      actual !== null &&
      typeof actual === 'object' &&
      Object.entries(expected).every(([key, value]) =>
        containsSettings(
          Object.entries(actual).find(([name]) => name === key)?.[1],
          value,
        ),
      )
    );
  return actual === expected;
}
