import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { parseDocument } from 'yaml';
import { z } from 'zod';

import { preconditionError } from '../../utils/fail';
import type { exec } from '../docker/exec';

export const RUNTIME_SERVICES = [
  'db',
  'knowledge-db',
  'bgutil-provider',
  'platform',
  'object-store',
  'backend-api',
  'backend-worker',
  'proxy',
  'sandbox-egress',
  'sandbox',
  'sandbox-llm-gateway',
] as const;
export const TALE_REGISTRY = 'ghcr.io/tale-project/tale';
export const RUNTIME_FILES = ['compose.yml', 'Caddyfile.production'] as const;
export const hash = (bytes: string | Buffer): string =>
  createHash('sha256').update(bytes).digest('hex');
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const revisionSchema = z.string().regex(/^[a-f0-9]{40}$/);
export const platformSchema = z.enum(['linux/amd64', 'linux/arm64']);
export type RuntimePlatform = z.infer<typeof platformSchema>;

export const runtimeImageSchema = z
  .object({
    repository: z.string().regex(/^[a-z0-9][a-z0-9.:/-]+$/),
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    reference: z.string().regex(/^[a-z0-9][a-z0-9.:/-]+@sha256:[a-f0-9]{64}$/),
    sourceTag: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/),
    revision: revisionSchema.nullable(),
    os: z.literal('linux'),
    architecture: z.enum(['amd64', 'arm64']),
    services: z.array(z.enum(RUNTIME_SERVICES)),
    localAliases: z.array(
      z.enum(['tale-sandbox-runtime:latest', 'tale-sandbox-buildkitd:latest']),
    ),
  })
  .strict();
export type RuntimeImage = z.infer<typeof runtimeImageSchema>;

export const runtimeBundleSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('source-compose-0.5'),
    revision: revisionSchema,
    platform: platformSchema,
    source: z.object({ composeSha256: sha256, caddySha256: sha256 }).strict(),
    files: z
      .object({ 'compose.yml': sha256, 'Caddyfile.production': sha256 })
      .strict(),
    services: z.array(z.enum(RUNTIME_SERVICES)).length(RUNTIME_SERVICES.length),
    images: z.array(runtimeImageSchema).min(8).max(20),
  })
  .strict();
export type RuntimeBundle = z.infer<typeof runtimeBundleSchema>;

export interface RuntimeDependencies {
  exec?: typeof exec;
  sleep?: (milliseconds: number) => Promise<void>;
  /** Isolated tests must not create the production host workspace. */
  ensureSandboxWorkspace?: () => void;
}
export interface PrepareRuntimeOptions {
  repoRoot: string;
  revision: string;
  output: string;
  platform: RuntimePlatform;
}
export interface ApplyRuntimeOptions {
  bundleDirectory: string;
  stateDirectory: string;
  composeProject: string;
  name: string;
  origin: string;
  tlsMode: 'external' | 'letsencrypt';
  tlsEmail?: string;
  environment?: Record<string, string>;
  dryRun?: boolean;
}
export interface RuntimeResult {
  backendContainer: string | null;
  sourceDirectory: string;
  regeneratedSecrets: string[];
  images: RuntimeImage[];
  revision: string;
  changed: boolean;
  existing: boolean;
  dryRun: boolean;
}

export function requireRuntime(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw preconditionError(message);
}

export function readRegular(file: string): Buffer {
  const status = lstatSync(file);
  requireRuntime(
    status.isFile() && !status.isSymbolicLink(),
    'Runtime input must be a regular file.',
  );
  requireRuntime(
    status.size <= 2_000_000,
    'Runtime input exceeds its size limit.',
  );
  return readFileSync(file);
}

/** Never truncate an existing managed file, and never follow a file symlink. */
export function atomicRuntimeFile(file: string, bytes: string | Buffer): void {
  try {
    const old = lstatSync(file);
    requireRuntime(
      old.isFile() && !old.isSymbolicLink(),
      'Managed runtime path is not a regular file.',
    );
    if (readFileSync(file).equals(Buffer.from(bytes))) {
      chmodSync(file, 0o600);
      return;
    }
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      throw error;
  }
  const temporary = `${file}.pending-${randomUUID()}`;
  writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx' });
  renameSync(temporary, file);
}

export type ComposeDocument = Record<string, unknown> & {
  services: Record<string, Record<string, unknown>>;
  volumes: Record<string, unknown>;
  networks: Record<string, unknown>;
};
export function parseCompose(source: string): ComposeDocument {
  const document = parseDocument(source, { uniqueKeys: true });
  requireRuntime(
    document.errors.length === 0,
    'Invalid runtime Compose source.',
  );
  const parsed = z
    .object({
      services: z.record(z.string(), z.record(z.string(), z.unknown())),
      volumes: z.record(z.string(), z.unknown()),
      networks: z.record(z.string(), z.unknown()),
    })
    .passthrough()
    .safeParse(document.toJS({ maxAliasCount: 20 }));
  requireRuntime(
    parsed.success,
    'Runtime Compose source has an unsupported shape.',
  );
  const compose = parsed.data;
  requireRuntime(
    Object.keys(compose.services).sort().join(',') ===
      [...RUNTIME_SERVICES].sort().join(','),
    'Runtime source is not the supported complete 0.5 Compose topology.',
  );
  requireRuntime(
    Object.values(compose.volumes).every((volume) => {
      const definition = z
        .object({ driver: z.literal('local').optional() })
        .strict()
        .safeParse(volume);
      return definition.success;
    }),
    'Runtime contains externally remapped data volumes.',
  );
  requireRuntime(
    JSON.stringify(Object.keys(compose.networks).sort()) ===
      '["internal","sandbox"]',
    'Runtime has an unrecognized network topology.',
  );
  const sandboxNetwork = z
    .object({ external: z.literal(true), name: z.literal('tale-sandbox-net') })
    .strict()
    .safeParse(compose.networks.sandbox);
  requireRuntime(
    sandboxNetwork.success,
    'Runtime sandbox network binding differs.',
  );
  requireRuntime(
    z
      .object({ driver: z.literal('bridge') })
      .strict()
      .safeParse(compose.networks.internal).success,
    'Runtime internal network binding differs.',
  );
  for (const [name, service] of Object.entries(compose.services)) {
    requireRuntime(
      service.network_mode === undefined && service.include === undefined,
      'Runtime service bypasses managed networking.',
    );
    const mounts = z.array(z.string()).safeParse(service.volumes ?? []);
    requireRuntime(
      mounts.success,
      'Runtime mount declarations are unsupported.',
    );
    for (const mount of mounts.data) {
      const [from, to, mode, extra] = mount
        .replace('${PLATFORM_SHARED_CONFIG:-config-data}', 'config-data')
        .split(':');
      requireRuntime(
        from &&
          to?.startsWith('/') &&
          extra === undefined &&
          (mode === undefined || mode === 'ro'),
        'Runtime mount declaration is unsupported.',
      );
      const named =
        !mount.includes('${') && Object.hasOwn(compose.volumes, from);
      const sandboxConfig =
        name === 'sandbox' &&
        mount ===
          '${PLATFORM_SHARED_CONFIG:-config-data}:/app/platform-config:ro';
      const sandboxHost =
        name === 'sandbox' &&
        ['/var/run/docker.sock', '/var/lib/tale-sandbox'].includes(from) &&
        to === from &&
        mode === undefined;
      const proxy =
        name === 'proxy' &&
        from === './Caddyfile.production' &&
        to === '/etc/caddy/Caddyfile' &&
        mode === 'ro';
      requireRuntime(
        named || sandboxConfig || sandboxHost || proxy,
        'Runtime source contains an unrecognized host mount.',
      );
    }
    const envFiles = z
      .array(
        z.union([
          z.string(),
          z
            .object({ path: z.string(), required: z.boolean().optional() })
            .strict(),
        ]),
      )
      .safeParse(service.env_file ?? []);
    requireRuntime(
      envFiles.success &&
        envFiles.data.every(
          (file) => (typeof file === 'string' ? file : file.path) === '.env',
        ),
      'Runtime source refers to an unrecognized environment file.',
    );
    const ports = JSON.stringify(service.ports ?? []);
    const allowedPorts: Record<string, string[]> = {
      db: ['["5432:5432"]', '["127.0.0.1:5432:5432"]'],
      'knowledge-db': ['["5433:5432"]', '["127.0.0.1:5433:5432"]'],
      proxy: ['["80:80","443:443"]'],
      sandbox: ['["127.0.0.1:8003:8003"]'],
    };
    requireRuntime(
      (allowedPorts[name] ?? ['[]']).includes(ports),
      'Runtime source contains an unrecognized published port.',
    );
  }
  return compose;
}

export function readRuntimeBundle(directory: string): {
  bundle: RuntimeBundle;
  identity: string;
  compose: ComposeDocument;
  contents: Record<(typeof RUNTIME_FILES)[number], Buffer>;
} {
  const raw = readRegular(join(directory, 'runtime.json'));
  let input: unknown;
  try {
    input = JSON.parse(raw.toString('utf8'));
  } catch {
    throw preconditionError('Invalid runtime bundle manifest.');
  }
  const parsed = runtimeBundleSchema.safeParse(input);
  requireRuntime(parsed.success, 'Invalid runtime bundle manifest.');
  const bundle = parsed.data;
  requireRuntime(
    new Set(bundle.services).size === RUNTIME_SERVICES.length,
    'Duplicate runtime service.',
  );
  const contents = {
    'compose.yml': readRegular(join(directory, 'compose.yml')),
    'Caddyfile.production': readRegular(
      join(directory, 'Caddyfile.production'),
    ),
  };
  for (const file of RUNTIME_FILES) {
    requireRuntime(
      hash(contents[file]) === bundle.files[file],
      'Runtime bundle file digest differs.',
    );
  }
  requireRuntime(
    new Set(bundle.images.map((image) => image.repository)).size ===
      bundle.images.length,
    'Duplicate runtime image repository.',
  );
  for (const image of bundle.images) {
    requireRuntime(
      image.reference === `${image.repository}@${image.digest}`,
      'Runtime image reference differs from its digest.',
    );
    requireRuntime(
      `${image.os}/${image.architecture}` === bundle.platform,
      'Runtime image platform differs.',
    );
    requireRuntime(
      !image.repository.startsWith(`${TALE_REGISTRY}/`) ||
        image.revision === bundle.revision,
      'Runtime image source revision differs.',
    );
  }
  const compose = parseCompose(contents['compose.yml'].toString('utf8'));
  for (const service of RUNTIME_SERVICES) {
    const spec = compose.services[service];
    const matches = bundle.images.filter((image) =>
      image.services.includes(service),
    );
    requireRuntime(
      matches.length === 1 &&
        spec.image === matches[0]?.reference &&
        spec.build === undefined,
      'Runtime service image custody differs.',
    );
    requireRuntime(
      spec.pull_policy === 'never',
      'Runtime service pull policy is not fixed.',
    );
  }
  requireRuntime(
    JSON.stringify(compose.services.db.ports) === '["127.0.0.1:5432:5432"]' &&
      JSON.stringify(compose.services['knowledge-db'].ports) ===
        '["127.0.0.1:5433:5432"]',
    'Runtime database exposure policy differs.',
  );
  requireRuntime(
    Array.isArray(compose.services.proxy.volumes) &&
      compose.services.proxy.volumes.includes(
        './Caddyfile.production:/etc/caddy/Caddyfile:ro',
      ),
    'Runtime proxy policy mount is missing.',
  );
  const caddy = contents['Caddyfile.production'].toString('utf8');
  requireRuntime(
    !caddy.includes('{$DOCS_ORIGIN:') &&
      caddy.includes('handle /api/auth/sign-up/email {') &&
      caddy.includes('handle /api/auth/organization/create {'),
    'Runtime public provisioning policy is missing.',
  );
  const environment = z
    .record(z.string(), z.unknown())
    .parse(compose.services.sandbox.environment);
  for (const [key, repository, alias] of [
    [
      'SANDBOX_RUNTIME_IMAGE',
      `${TALE_REGISTRY}/tale-sandbox-runtime`,
      'tale-sandbox-runtime:latest',
    ],
    [
      'SANDBOX_BUILDKITD_IMAGE',
      `${TALE_REGISTRY}/tale-sandbox-buildkitd`,
      'tale-sandbox-buildkitd:latest',
    ],
    ['SANDBOX_BUILDKITD_MIRROR_IMAGE', 'registry', null],
  ] as const) {
    const image = bundle.images.find((item) => item.repository === repository);
    requireRuntime(
      image &&
        environment[key] === image.reference &&
        (alias === null || image.localAliases.includes(alias)),
      'Runtime spawner image custody differs.',
    );
  }
  return { bundle, identity: hash(raw), compose, contents };
}
