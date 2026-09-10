import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { stringify } from 'yaml';
import { z } from 'zod';

import { externalDepError, preconditionError } from '../../utils/fail';
import { git } from '../config/releases/git';
import { runtimeCommand } from './runtime-command';
import {
  atomicRuntimeFile,
  hash,
  parseCompose,
  platformSchema,
  readRegular,
  requireRuntime,
  revisionSchema,
  RUNTIME_FILES,
  RUNTIME_SERVICES,
  runtimeBundleSchema,
  TALE_REGISTRY,
  type PrepareRuntimeOptions,
  type RuntimeBundle,
  type RuntimeDependencies,
  type RuntimeImage,
  type RuntimePlatform,
} from './runtime-model';

const imageInspectSchema = z.object({
  Os: z.string(),
  Architecture: z.string(),
  RepoDigests: z.array(z.string()),
  Config: z.object({
    Labels: z.record(z.string(), z.string()).nullable().optional(),
  }),
});
const normalizedRepository = (value: string): string =>
  value.replace(/^docker\.io\/(?:library\/)?/, '').replace(/^library\//, '');

export async function inspectRuntimeImage(
  reference: string,
  repository: string,
  platform: RuntimePlatform,
  revision: string | null,
  dependencies: RuntimeDependencies,
): Promise<{ digest: string; reference: string; revision: string | null }> {
  const result = await runtimeCommand(
    ['image', 'inspect', reference],
    dependencies,
  );
  let raw: unknown;
  try {
    raw = JSON.parse(result.stdout);
  } catch {
    throw externalDepError('Docker returned invalid image metadata.');
  }
  const parsed = z.array(imageInspectSchema).length(1).safeParse(raw);
  requireRuntime(parsed.success, 'Docker image metadata is incomplete.');
  const image = parsed.data[0];
  requireRuntime(
    `${image.Os}/${image.Architecture}` === platform,
    'Selected runtime image does not support the requested platform.',
  );
  requireRuntime(
    revision === null ||
      image.Config.Labels?.['org.opencontainers.image.revision'] === revision,
    'Selected Tale image does not match the complete source revision.',
  );
  const digests = image.RepoDigests.filter((digest) => {
    const split = digest.lastIndexOf('@');
    return (
      normalizedRepository(digest.slice(0, split)) ===
        normalizedRepository(repository) &&
      /^sha256:[a-f0-9]{64}$/.test(digest.slice(split + 1))
    );
  });
  const unique = [
    ...new Set(
      digests.map((digest) => digest.slice(digest.lastIndexOf('@') + 1)),
    ),
  ];
  requireRuntime(
    unique.length === 1,
    'Docker did not prove one repository digest for the selected runtime image.',
  );
  return {
    digest: unique[0],
    reference: `${repository}@${unique[0]}`,
    revision:
      image.Config.Labels?.['org.opencontainers.image.revision'] ?? null,
  };
}

async function resolveImage(
  repository: string,
  sourceTags: string[],
  platform: RuntimePlatform,
  revision: string | null,
  dependencies: RuntimeDependencies,
  requireSameDigest: boolean,
): Promise<RuntimeImage | null> {
  let selected: RuntimeImage | null = null;
  for (const tag of sourceTags) {
    const reference = tag.startsWith('sha256:')
      ? `${repository}@${tag}`
      : `${repository}:${tag}`;
    const pulled = await runtimeCommand(
      ['pull', '--platform', platform, reference],
      dependencies,
      { timeout: 1800, allowFailure: true },
    );
    if (!pulled.success) {
      requireRuntime(
        /manifest unknown|not found|no matching manifest/i.test(pulled.stderr),
        'Runtime image pull failed; image provenance cannot be established.',
      );
      continue;
    }
    const identity = await inspectRuntimeImage(
      reference,
      repository,
      platform,
      revision,
      dependencies,
    );
    if (selected) {
      requireRuntime(
        selected.digest === identity.digest,
        'Multiple historical release tags for this source resolve to different image bytes.',
      );
    } else {
      selected = {
        repository,
        ...identity,
        sourceTag: tag,
        revision,
        os: 'linux',
        architecture: platform === 'linux/amd64' ? 'amd64' : 'arm64',
        services: [],
        localAliases: [],
      };
    }
    if (!requireSameDigest) break;
  }
  return selected;
}

function proxyPolicy(source: string): string {
  const lines = source.split('\n');
  requireRuntime(
    lines.filter((line) => line.includes('# BACKEND_PLACEHOLDER')).length ===
      1 &&
      lines.filter((line) => line.startsWith('{$DOCS_ORIGIN:')).length === 1 &&
      lines.filter((line) => line.startsWith('{$SITE_ORIGIN:')).length === 1,
    'Tale proxy source changed; review the managed provisioning policy.',
  );
  let skip = false;
  const result: string[] = [];
  for (const line of lines) {
    if (line.startsWith('{$DOCS_ORIGIN:')) skip = true;
    if (line.startsWith('{$SITE_ORIGIN:')) skip = false;
    if (skip) continue;
    if (line.includes('# BACKEND_PLACEHOLDER')) {
      result.push(
        '\thandle /api/auth/sign-up/email {',
        '\t\trespond "Account provisioning is managed by the operator" 403',
        '\t}',
        '\thandle /api/auth/organization/create {',
        '\t\trespond "Organization provisioning is managed by the operator" 403',
        '\t}',
      );
    }
    result.push(line);
  }
  return result.join('\n');
}

function sourceFiles(
  repoRoot: string,
  revision: string,
): {
  compose: Buffer;
  caddy: Buffer;
  tags: string[];
} {
  try {
    requireRuntime(
      git(repoRoot, 'rev-parse', `${revision}^{commit}`).toString().trim() ===
        revision,
      'Runtime revision must identify an exact committed source tree.',
    );
    for (const file of ['compose.yml', 'services/proxy/Caddyfile']) {
      requireRuntime(
        /^100644 blob [a-f0-9]{40}\t/.test(
          git(repoRoot, 'ls-tree', revision, '--', file).toString(),
        ),
        'Runtime source must be a committed regular file.',
      );
    }
    return {
      compose: git(repoRoot, 'show', `${revision}:compose.yml`),
      caddy: git(repoRoot, 'show', `${revision}:services/proxy/Caddyfile`),
      tags: git(repoRoot, 'tag', '--points-at', revision)
        .toString()
        .split('\n')
        .filter((tag) =>
          /^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(tag),
        )
        .map((tag) => tag.replace(/^v/, ''))
        .sort(),
    };
  } catch {
    throw preconditionError(
      'The exact runtime source commit and required files must be available locally.',
    );
  }
}

/** Prepare an immutable runtime without copying source checkouts or credentials. */
export async function prepareRuntime(
  options: PrepareRuntimeOptions,
  dependencies: RuntimeDependencies = {},
): Promise<RuntimeBundle> {
  revisionSchema.parse(options.revision);
  platformSchema.parse(options.platform);
  const output = resolve(options.output);
  requireRuntime(
    output !== resolve(options.repoRoot),
    'Runtime output must be separate from the source checkout.',
  );
  const source = sourceFiles(options.repoRoot, options.revision);
  const compose = parseCompose(source.compose.toString('utf8'));
  const caddy = proxyPolicy(source.caddy.toString('utf8'));
  const images = new Map<string, RuntimeImage>();
  const getImage = async (
    repository: string,
    externalTag?: string,
  ): Promise<RuntimeImage> => {
    const prior = images.get(repository);
    if (prior) return prior;
    const revision = repository.startsWith(`${TALE_REGISTRY}/`)
      ? options.revision
      : null;
    const historical = revision === null ? [] : source.tags;
    let selected = historical.length
      ? await resolveImage(
          repository,
          historical,
          options.platform,
          revision,
          dependencies,
          true,
        )
      : null;
    selected ??= await resolveImage(
      repository,
      externalTag === undefined
        ? [`sha-${options.revision}`, `sha-${options.revision.slice(0, 7)}`]
        : [externalTag],
      options.platform,
      revision,
      dependencies,
      false,
    );
    requireRuntime(
      selected,
      'No verified image is available for this source commit and platform.',
    );
    images.set(repository, selected);
    return selected;
  };
  for (const service of RUNTIME_SERVICES) {
    const spec = compose.services[service];
    requireRuntime(
      typeof spec.image === 'string',
      'Runtime service has no image.',
    );
    const tale =
      /^(ghcr\.io\/tale-project\/tale\/tale-[a-z-]+):\$\{VERSION:-latest\}$/.exec(
        spec.image,
      );
    const external =
      /^([a-z0-9][a-z0-9./:-]+?)(?::([a-zA-Z0-9_.-]+)|@(sha256:[a-f0-9]{64}))$/.exec(
        spec.image,
      );
    const candidate = tale ?? external;
    requireRuntime(
      candidate,
      'Runtime source contains an unsupported image reference.',
    );
    const image = await getImage(
      candidate[1],
      tale ? undefined : (candidate[2] ?? candidate[3]),
    );
    image.services.push(service);
    spec.image = image.reference;
    delete spec.build;
    spec.pull_policy = 'never';
  }
  for (const name of ['runtime', 'buildkitd'] as const) {
    const image = await getImage(`${TALE_REGISTRY}/tale-sandbox-${name}`);
    image.localAliases.push(`tale-sandbox-${name}:latest`);
  }
  const sandboxEnvironment = z
    .record(z.string(), z.unknown())
    .parse(compose.services.sandbox.environment);
  requireRuntime(
    sandboxEnvironment.SANDBOX_RUNTIME_IMAGE ===
      '${SANDBOX_RUNTIME_IMAGE:-tale-sandbox-runtime:latest}' &&
      sandboxEnvironment.SANDBOX_BUILDKITD_IMAGE ===
        '${SANDBOX_BUILDKITD_IMAGE:-tale-sandbox-buildkitd:latest}' &&
      sandboxEnvironment.SANDBOX_BUILDKITD_MIRROR_IMAGE ===
        '${SANDBOX_BUILDKITD_MIRROR_IMAGE:-registry:2}',
    'Runtime sandbox image routing changed.',
  );
  sandboxEnvironment.SANDBOX_RUNTIME_IMAGE = images.get(
    `${TALE_REGISTRY}/tale-sandbox-runtime`,
  )?.reference;
  sandboxEnvironment.SANDBOX_BUILDKITD_IMAGE = images.get(
    `${TALE_REGISTRY}/tale-sandbox-buildkitd`,
  )?.reference;
  // The pull-through mirror is another spawner-created image, outside Compose.
  sandboxEnvironment.SANDBOX_BUILDKITD_MIRROR_IMAGE = (
    await getImage('registry', '2')
  ).reference;
  compose.services.sandbox.environment = sandboxEnvironment;
  const sandboxVolumes = z
    .array(z.string())
    .parse(compose.services.sandbox.volumes);
  requireRuntime(
    sandboxVolumes.includes(
      '${PLATFORM_SHARED_CONFIG:-config-data}:/app/platform-config:ro',
    ),
    'Runtime config-store mount changed.',
  );
  compose.services.sandbox.volumes = sandboxVolumes.map((volume) =>
    volume === '${PLATFORM_SHARED_CONFIG:-config-data}:/app/platform-config:ro'
      ? 'config-data:/app/platform-config:ro'
      : volume,
  );
  compose.services.db.ports = ['127.0.0.1:5432:5432'];
  compose.services['knowledge-db'].ports = ['127.0.0.1:5433:5432'];
  const proxyVolumes = z
    .array(z.string())
    .parse(compose.services.proxy.volumes);
  requireRuntime(
    proxyVolumes.every((volume) => !volume.includes('/etc/caddy/Caddyfile')),
    'Runtime proxy has an unrecognized source mount.',
  );
  compose.services.proxy.volumes = [
    ...proxyVolumes,
    './Caddyfile.production:/etc/caddy/Caddyfile:ro',
  ];
  const productionCompose = stringify(compose, { lineWidth: 0 });
  const bundle = runtimeBundleSchema.parse({
    schemaVersion: 1,
    kind: 'source-compose-0.5',
    revision: options.revision,
    platform: options.platform,
    source: {
      composeSha256: hash(source.compose),
      caddySha256: hash(source.caddy),
    },
    files: {
      'compose.yml': hash(productionCompose),
      'Caddyfile.production': hash(caddy),
    },
    services: [...RUNTIME_SERVICES],
    images: [...images.values()].sort((a, b) =>
      a.repository.localeCompare(b.repository),
    ),
  });
  const files = {
    'compose.yml': productionCompose,
    'Caddyfile.production': caddy,
    'runtime.json': `${JSON.stringify(bundle, null, 2)}\n`,
  };
  if (existsSync(output)) {
    requireRuntime(
      readdirSync(output).every((file) =>
        [...RUNTIME_FILES, 'runtime.json'].includes(file),
      ),
      'Runtime output contains unrelated files.',
    );
    for (const [file, contents] of Object.entries(files)) {
      requireRuntime(
        !existsSync(join(output, file)) ||
          readRegular(join(output, file)).equals(Buffer.from(contents)),
        'Existing runtime bundle differs; select a new output directory.',
      );
    }
  } else mkdirSync(output, { recursive: true, mode: 0o750 });
  for (const [file, contents] of Object.entries(files))
    atomicRuntimeFile(join(output, file), contents);
  return bundle;
}
