import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parse, stringify } from 'yaml';

import type { exec } from '../docker/exec';
import { RUNTIME_SECRET_KEYS } from './runtime-env';
import {
  hash,
  RUNTIME_SERVICES,
  TALE_REGISTRY,
  type ApplyRuntimeOptions,
  type ComposeDocument,
  type RuntimeDependencies,
} from './runtime-model';

export function runtimeFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'tale-managed-runtime-'));
  const repoRoot = join(directory, 'repo');
  mkdirSync(join(repoRoot, 'services/proxy'), { recursive: true });
  const source: ComposeDocument = {
    services: {},
    networks: {
      internal: { driver: 'bridge' },
      sandbox: { external: true, name: 'tale-sandbox-net' },
    },
    volumes: {
      'db-data': {},
      'db-backup': {},
      'knowledge-db-data': {},
      'knowledge-db-backup': {},
      'config-data': {},
      'object-store-data': {},
      'caddy-data': {},
      'caddy-config': {},
      'llm-gateway-data': {},
      'convex-data': {},
      'platform-data': {},
    },
  };
  const images: Record<string, string> = {
    db: 'tale-db',
    'knowledge-db': 'tale-db',
    platform: 'tale-platform',
    'backend-api': 'tale-platform',
    'backend-worker': 'tale-platform',
    proxy: 'tale-proxy',
    sandbox: 'tale-sandbox',
    'sandbox-egress': 'tale-sandbox-egress',
    'sandbox-llm-gateway': 'tale-sandbox-llm-gateway',
  };
  for (const name of RUNTIME_SERVICES)
    source.services[name] = {
      ...(name === 'backend-api' || name === 'backend-worker'
        ? {}
        : { container_name: `tale-${name}` }),
      image: images[name]
        ? `${TALE_REGISTRY}/${images[name]}:\${VERSION:-latest}`
        : name === 'object-store'
          ? 'minio/minio:RELEASE.2025-04-22T22-12-26Z'
          : 'brainicism/bgutil-ytdlp-pot-provider:1.3.1',
      build: { context: '.', dockerfile: `services/${name}/Dockerfile` },
      env_file: [{ path: '.env', required: false }],
      healthcheck:
        name === 'backend-worker'
          ? { disable: true }
          : { test: ['CMD', 'true'] },
    };
  source.services.db.volumes = [
    'db-data:/var/lib/postgresql/data',
    'db-backup:/var/lib/postgresql/backup',
  ];
  source.services.db.ports = ['5432:5432'];
  source.services['knowledge-db'].volumes = [
    'knowledge-db-data:/var/lib/postgresql/data',
    'knowledge-db-backup:/var/lib/postgresql/backup',
  ];
  source.services['knowledge-db'].ports = ['5433:5432'];
  for (const name of ['platform', 'backend-api', 'backend-worker'])
    source.services[name].volumes = [
      `config-data:/app/data${name === 'platform' ? ':ro' : ''}`,
    ];
  source.services['object-store'].volumes = ['object-store-data:/data'];
  source.services.proxy.volumes = ['caddy-data:/data', 'caddy-config:/config'];
  source.services.proxy.ports = ['80:80', '443:443'];
  source.services['sandbox-llm-gateway'].volumes = [
    'llm-gateway-data:/app/data',
  ];
  source.services.sandbox.volumes = [
    '/var/run/docker.sock:/var/run/docker.sock',
    '/var/lib/tale-sandbox:/var/lib/tale-sandbox',
    '${PLATFORM_SHARED_CONFIG:-config-data}:/app/platform-config:ro',
  ];
  source.services.sandbox.ports = ['127.0.0.1:8003:8003'];
  source.services.sandbox.environment = {
    SANDBOX_RUNTIME_IMAGE:
      '${SANDBOX_RUNTIME_IMAGE:-tale-sandbox-runtime:latest}',
    SANDBOX_BUILDKITD_IMAGE:
      '${SANDBOX_BUILDKITD_IMAGE:-tale-sandbox-buildkitd:latest}',
    SANDBOX_BUILDKITD_MIRROR_IMAGE:
      '${SANDBOX_BUILDKITD_MIRROR_IMAGE:-registry:2}',
  };
  const caddy =
    '{\n default_sni {$HOST:localhost}\n}\n{$DOCS_ORIGIN:https://docs.localhost} {\n respond "docs"\n}\n{$SITE_ORIGIN:https://localhost} {\n # TLS_PLACEHOLDER\n # BACKEND_PLACEHOLDER\n reverse_proxy platform:3000\n}\n';
  writeFileSync(join(repoRoot, 'compose.yml'), stringify(source));
  writeFileSync(join(repoRoot, 'services/proxy/Caddyfile'), caddy);
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', repoRoot, ...args], {
      env: {
        PATH: process.env.PATH,
        HOME: directory,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_AUTHOR_NAME: 'Runtime Test',
        GIT_AUTHOR_EMAIL: 'runtime@example.invalid',
        GIT_COMMITTER_NAME: 'Runtime Test',
        GIT_COMMITTER_EMAIL: 'runtime@example.invalid',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .toString()
      .trim();
  git('init', '-q');
  git('add', '.');
  git('commit', '-qm', 'test runtime source');
  const revision = git('rev-parse', 'HEAD');
  const options: ApplyRuntimeOptions = {
    bundleDirectory: join(directory, 'bundle'),
    stateDirectory: join(directory, 'state'),
    composeProject: 'tale',
    name: 'example-native',
    origin: 'https://native.example.invalid',
    tlsMode: 'external',
  };
  return { directory, repoRoot, source, caddy, revision, git, options };
}
export type RuntimeFixture = ReturnType<typeof runtimeFixture>;

export class RuntimeDockerFixture {
  calls: { args: string[]; options: Parameters<typeof exec>[2] }[] = [];
  network = false;
  unsafeNetwork: Record<string, unknown> | null = null;
  containers: Record<string, unknown>[] = [];
  volumes: string[] = [];
  foreignNames: string[] = [];
  missingTags = new Set<string>();
  imageRevision: string | null = null;
  architecture: string | null = null;
  variantTag: string | null = null;
  upFailure = false;
  onUp: (() => void) | null = null;
  imageMetadata = new Map<string, Record<string, unknown>>();
  constructor(readonly fixture: RuntimeFixture) {}

  installContainers(compose: ComposeDocument): void {
    this.containers = RUNTIME_SERVICES.map((service, index) => {
      const spec = compose.services[service];
      return {
        Id: (index + 1).toString(16).padStart(64, '0'),
        Name: `/tale-${service}`,
        Config: {
          Image: spec.image,
          Labels: {
            'com.docker.compose.project': this.fixture.options.composeProject,
            'com.docker.compose.service': service,
            'com.docker.compose.project.working_dir': join(
              this.fixture.options.stateDirectory,
              'src',
            ),
            'com.docker.compose.container-number': '1',
            'com.docker.compose.oneoff': 'False',
          },
        },
        State:
          service === 'backend-worker'
            ? { Running: true }
            : { Running: true, Health: { Status: 'healthy' } },
        Mounts: ((spec.volumes as string[]) ?? []).map((mount) => {
          const [raw, destination, mode] = mount.split(':');
          const volume = Object.hasOwn(compose.volumes, raw);
          return {
            Type: volume ? 'volume' : 'bind',
            Name: volume ? `tale_${raw}` : undefined,
            Source: volume
              ? `/var/lib/docker/volumes/tale_${raw}/_data`
              : raw.startsWith('./')
                ? join(this.fixture.options.stateDirectory, 'src', raw.slice(2))
                : raw,
            Destination: destination,
            RW: mode !== 'ro',
          };
        }),
      };
    });
    this.volumes = Object.keys(compose.volumes).map((name) => `tale_${name}`);
  }

  readonly execute: typeof exec = async (_command, args, options) => {
    this.calls.push({ args, options });
    const ok = (value: string | unknown = '') => ({
      success: true,
      stdout: typeof value === 'string' ? value : JSON.stringify(value),
      stderr: '',
      exitCode: 0,
    });
    if (args[0] === 'info') return ok('linux/x86_64');
    if (args[0] === 'pull') {
      const reference = args.at(-1);
      if (!reference) throw new Error('Fixture pull reference missing');
      if (
        this.missingTags.has(reference) ||
        this.missingTags.has(reference.slice(reference.lastIndexOf(':') + 1))
      )
        return {
          success: false,
          stdout: '',
          stderr: 'manifest unknown',
          exitCode: 1,
        };
      const separator = reference.includes('@')
        ? reference.lastIndexOf('@')
        : reference.lastIndexOf(':');
      const repository = reference.slice(0, separator);
      const tag = reference.slice(separator + 1);
      const digest = tag.startsWith('sha256:')
        ? tag
        : `sha256:${hash(repository + (tag === this.variantTag ? tag : 'fixture'))}`;
      const data = {
        Os: 'linux',
        Architecture: this.architecture ?? args[2].split('/')[1],
        RepoDigests: [`${repository}@${digest}`],
        Config: {
          Labels: repository.startsWith(`${TALE_REGISTRY}/`)
            ? {
                'org.opencontainers.image.revision':
                  this.imageRevision ?? this.fixture.revision,
              }
            : {},
        },
      };
      this.imageMetadata.set(reference, data);
      this.imageMetadata.set(`${repository}@${digest}`, data);
      return ok();
    }
    if (args[0] === 'image' && args[1] === 'inspect') {
      const data = this.imageMetadata.get(args[2]);
      return data
        ? ok([data])
        : {
            success: false,
            stdout: '',
            stderr: 'image not found',
            exitCode: 1,
          };
    }
    if (args[0] === 'network' && args[1] === 'inspect')
      return this.network
        ? ok([
            this.unsafeNetwork ?? {
              Driver: 'bridge',
              Internal: true,
              EnableIPv6: false,
            },
          ])
        : {
            success: false,
            stdout: '',
            stderr: 'no such network',
            exitCode: 1,
          };
    if (args[0] === 'network' && args[1] === 'create') {
      this.network = true;
      return ok();
    }
    if (args[0] === 'ps' && !args.includes('--filter'))
      return ok(
        [
          ...this.containers.map(
            (container) =>
              `${container.Id}\t${String(container.Name).replace(/^\//, '')}`,
          ),
          ...this.foreignNames.map((name) => `${'e'.repeat(64)}\t${name}`),
        ].join('\n'),
      );
    if (args[0] === 'ps')
      return ok(this.containers.map((container) => container.Id).join('\n'));
    if (args[0] === 'container' && args[1] === 'inspect')
      return ok(this.containers);
    if (args[0] === 'volume' && args[1] === 'ls')
      return ok(this.volumes.join('\n'));
    if (args[0] === 'tag') {
      const image = this.imageMetadata.get(args[1]);
      if (!image) throw new Error('Fixture tag source missing');
      this.imageMetadata.set(args[2], image);
      return ok();
    }
    if (args[0] === 'compose' && args.includes('config')) return ok();
    if (args[0] === 'compose' && args.includes('up')) {
      this.installContainers(
        parse(
          readFileSync(
            join(this.fixture.options.stateDirectory, 'src/compose.yml'),
            'utf8',
          ),
        ),
      );
      this.onUp?.();
      if (this.upFailure)
        throw new Error('Synthetic lost response after accepted up');
      return ok();
    }
    if (args[0] === 'exec' && args.includes('http://127.0.0.1:8003/health'))
      return ok();
    throw new Error(`Unexpected fixture command ${args[0]} ${args[1]}`);
  };
  dependencies(): RuntimeDependencies {
    return {
      exec: this.execute,
      sleep: async () => {},
      ensureSandboxWorkspace: () => {},
    };
  }
}

export function installLegacy(
  fixture: RuntimeFixture,
  docker: RuntimeDockerFixture,
) {
  const { stateDirectory, origin } = fixture.options;
  mkdirSync(join(stateDirectory, 'src'), { recursive: true });
  const values = Object.fromEntries(
    RUNTIME_SECRET_KEYS.map((key) => [key, randomBytes(20).toString('hex')]),
  );
  const secrets = Object.entries(values)
    .map(([key, value]) => `${key}=${value}\n`)
    .join('');
  writeFileSync(join(stateDirectory, 'secrets.env'), secrets, { mode: 0o600 });
  const environment = Object.entries({
    HOST: new URL(origin).hostname,
    SITE_URL: origin,
    TLS_MODE: 'external',
    TLS_EMAIL: '',
    VERSION: '0.5.16',
    ...Object.fromEntries(
      Object.entries(values).filter(
        ([key]) => key !== 'TALE_BOOTSTRAP_PASSWORD',
      ),
    ),
  })
    .map(([key, value]) => `${key}=${value}\n`)
    .join('');
  writeFileSync(join(stateDirectory, 'src/.env'), environment, { mode: 0o600 });
  const compose = parse(
    readFileSync(join(fixture.options.bundleDirectory, 'compose.yml'), 'utf8'),
  ) as ComposeDocument;
  writeFileSync(
    join(stateDirectory, 'src/compose.yml'),
    stringify(fixture.source),
  );
  writeFileSync(
    join(stateDirectory, 'src/Caddyfile.production'),
    'legacy production policy',
  );
  docker.installContainers(compose);
  docker.network = true;
  return { values, secrets, environment };
}
