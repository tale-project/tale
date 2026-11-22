import { expect } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CliError, ExitCode } from '../../../../utils/fail';
import { buildColorCompose } from '../../../compose/generators/generate-color-compose';
import { buildStatefulCompose } from '../../../compose/generators/generate-stateful-compose';
import type { ComposeConfig, ServiceConfig } from '../../../compose/types';
import type { ImageFacts } from '../../../oci/image-facts';
import { setProjectId } from '../../../project/project-context';
import {
  interpolate,
  interpolationSource,
  type InterpolationPath,
} from './interpolate';
import { REFUSAL_REASONS } from './refusals';
import {
  requireStackTarget,
  type CompileInput,
  type CompileResult,
  type IncusDeclaration,
} from './stack-target';
import { PATCHED_INIT } from './translate';

/**
 * Fixed inputs for the compiler's tests: a declaration per path, a `.env`,
 * and image facts shaped like the images the stack runs (their entrypoints,
 * stop signals, volumes and labels as the Dockerfiles declare them), so a
 * golden changes only when the compiler or a compose source does.
 */

export const PROJECT_ID = 'tale';
export const SERVICE_CONFIG: ServiceConfig = {
  version: '0.5.95',
  registry: 'ghcr.io/tale-project/tale',
};
export const HOST = 'demo.tale.dev';
const REVISION = '0123456789abcdef0123456789abcdef01234567';

/** The process variables the generators read; a test clears them so the
 * environment of the machine running it cannot move a golden. */
const GENERATOR_VARIABLES = [
  'SHUTDOWN_DRAIN_MS',
  'SANDBOX_DOCKER_DATA_ROOT',
  'SANDBOX_DOCKER_DATA_PATH',
  // SANDBOX_RESERVED_MEMORY is their sum, every replica counted.
  'DB_MEMORY_RESERVATION',
  'PLATFORM_MEMORY_RESERVATION',
  'BACKEND_API_MEMORY_RESERVATION',
  'BACKEND_WORKER_MEMORY_RESERVATION',
  'TALE_PLATFORM_REPLICAS',
  'TALE_BACKEND_API_REPLICAS',
  'TALE_BACKEND_WORKER_REPLICAS',
] as const;

function clearGeneratorVariables(): void {
  for (const name of GENERATOR_VARIABLES) delete process.env[name];
}

export const DOTENV = [
  '# A deployment .env, as `tale init` writes it',
  `HOST=${HOST}`,
  `SITE_URL=https://${HOST}`,
  'TLS_MODE=letsencrypt',
  'POSTGRES_USER=tale',
  'DB_PASSWORD=fixture-db-password',
  'OBJECT_STORE_SECRET_KEY=fixture-object-store-secret',
  'BETTER_AUTH_SECRET=fixture-auth-secret',
  'SANDBOX_INCUS_PROJECT=tale-sessions',
  '',
].join('\n');

const declaration = (block: string): IncusDeclaration => ({
  project: 'tale-stack',
  pool: 'tale',
  network: {
    name: 'talebr0',
    subnet: '10.30.0.0/16',
    gateway: '10.30.0.1',
    block,
  },
  sessions: { subnet: '10.40.0.0/24' },
  ingress: { mode: 'proxy-device' },
  volumes: {
    'db-data': { size: '50GiB', config: { 'snapshots.expiry': '14d' } },
  },
});

const WORKSPACE_DECLARATION = declaration('10.30.1.0/24');
const MANAGED_DECLARATION: IncusDeclaration = {
  ...declaration('10.30.2.0/25'),
  ingress: { mode: 'routed' },
};

export const SANDBOX_RUNTIME = {
  reference: `ghcr.io/tale-project/tale/tale-sandbox-runtime@sha256:${'5'.repeat(64)}`,
  digest: `sha256:${'5'.repeat(64)}`,
};

interface ImageShape {
  entrypoint: string[] | null;
  cmd: string[] | null;
  stopSignal?: string;
  volumes?: string[];
  user?: string;
  init?: boolean;
  labels?: Record<string, string>;
}

/** What each repository's image declares on the feature line
 * (services/<name>/Dockerfile). */
const IMAGE_SHAPES: Record<string, ImageShape> = {
  'tale-db': {
    entrypoint: ['/usr/local/bin/docker-entrypoint.sh'],
    cmd: ['postgres'],
    stopSignal: 'SIGINT',
    volumes: ['/var/lib/postgresql/data'],
    init: true,
  },
  'tale-platform': {
    entrypoint: ['/usr/bin/tini', '--'],
    cmd: ['/app/docker-entrypoint.sh'],
    init: true,
  },
  // The feature line's edge: the Traefik image of services/proxy/Dockerfile.
  // It declares one volume, its entrypoint and command, and no infra format.
  'tale-proxy': {
    entrypoint: ['tale-proxy'],
    cmd: ['edge'],
    stopSignal: 'SIGTERM',
    volumes: ['/data'],
    init: true,
  },
  'tale-sandbox': {
    entrypoint: ['/docker-entrypoint.sh'],
    cmd: null,
    init: true,
  },
  'tale-sandbox-egress': {
    entrypoint: ['/docker-entrypoint.sh'],
    cmd: null,
    init: true,
    labels: { 'dev.tale.infra-formats': 'names-hosts/1' },
  },
  // The blob store: versitygw's own image, which declares its entrypoint
  // and nothing else (no command, no volume, no user), and the MinIO rebuild
  // a deployment keeps while its blobs are in MinIO's volume.
  versitygw: {
    entrypoint: ['/usr/local/bin/docker-entrypoint.sh'],
    cmd: null,
  },
  minio: {
    entrypoint: ['/usr/bin/docker-entrypoint.sh'],
    cmd: ['minio'],
    volumes: ['/data'],
  },
  'bgutil-ytdlp-pot-provider': {
    entrypoint: ['docker-entrypoint.sh'],
    cmd: ['node', 'build/main.js'],
  },
};

/** The v0.5 line's images where they differ: its edge is the Caddy image,
 * with its two volumes, its entrypoint and command, and the switch format
 * the v0.5 edge reads. */
const V05_IMAGE_SHAPES: Record<string, ImageShape> = {
  ...IMAGE_SHAPES,
  'tale-proxy': {
    entrypoint: ['/usr/local/bin/docker-entrypoint.sh'],
    cmd: [
      'caddy',
      'run',
      '--config',
      '/config/Caddyfile',
      '--adapter',
      'caddyfile',
    ],
    volumes: ['/config', '/data'],
    init: true,
    labels: { 'dev.tale.infra-formats': 'switch-upstreams/1' },
  },
};

/** The release line whose images a fixture runs. Its proxy differs: Traefik
 * on the feature line, Caddy on v0.5. */
export type ReleaseLine = 'feature' | 'v0.5';

/** Image facts for `reference`, as the registry reader would return them. */
export function factsFor(
  reference: string,
  overrides: Partial<ImageFacts> = {},
  line: ReleaseLine = 'feature',
): ImageFacts {
  const at = reference.indexOf('@');
  const repository = (at === -1 ? reference : reference.slice(0, at)).replace(
    /:[^/:]+$/,
    '',
  );
  const digest =
    at === -1
      ? `sha256:${createHash('sha256').update(reference).digest('hex')}`
      : reference.slice(at + 1);
  const name = repository.slice(repository.lastIndexOf('/') + 1);
  const shape = (line === 'v0.5' ? V05_IMAGE_SHAPES : IMAGE_SHAPES)[name];
  if (shape === undefined) throw new Error(`No image shape for ${reference}.`);
  const tale = name.startsWith('tale-');
  const labels: Record<string, string> = {
    ...(tale
      ? {
          'org.opencontainers.image.version': SERVICE_CONFIG.version,
          'org.opencontainers.image.revision': REVISION,
        }
      : {}),
    ...(shape.init ? { 'dev.tale.init': PATCHED_INIT } : {}),
    ...shape.labels,
  };
  return {
    reference: `${repository}@${digest}`,
    digest,
    manifestDigest: digest,
    configDigest: digest,
    os: 'linux',
    architecture: 'amd64',
    variant: null,
    labels,
    revision: labels['org.opencontainers.image.revision'] ?? null,
    automationWriterProtocol: null,
    init: labels['dev.tale.init'] ?? null,
    entrypoint: shape.entrypoint,
    cmd: shape.cmd,
    env: ['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'],
    user: shape.user ?? null,
    workingDir: null,
    stopSignal: shape.stopSignal ?? null,
    healthcheck: null,
    volumes: shape.volumes ?? [],
    ...overrides,
  };
}

/** Facts for every image the documents name, after interpolation. */
function imagesOf(
  documents: readonly { compose: unknown }[],
  variables: Readonly<Record<string, string>>,
): Record<string, ImageFacts> {
  const images: Record<string, ImageFacts> = {};
  for (const { compose } of documents)
    for (const service of Object.values(
      (compose as ComposeConfig).services ?? {},
    )) {
      const reference = interpolate(String(service.image), (name) =>
        Object.hasOwn(variables, name) ? variables[name] : undefined,
      );
      images[reference] ??= factsFor(reference);
    }
  return images;
}

export function statefulDocument(): ComposeConfig {
  setProjectId(PROJECT_ID);
  clearGeneratorVariables();
  return buildStatefulCompose(SERVICE_CONFIG, HOST);
}

export function colourDocument(colour: 'blue' | 'green'): ComposeConfig {
  setProjectId(PROJECT_ID);
  clearGeneratorVariables();
  return buildColorCompose(SERVICE_CONFIG, colour);
}

/** A whole compile input over `documents`, for `path`. */
export function compileInput(
  path: InterpolationPath,
  documents: CompileInput['documents'],
  overrides: Partial<CompileInput> = {},
): CompileInput {
  const { variables } = interpolationSource(path, {
    dotenv: DOTENV,
    processEnvironment: {},
    documents: documents.map((document) => document.compose),
    project: PROJECT_ID,
  });
  return {
    path,
    stack: PROJECT_ID,
    documents,
    variables,
    envFiles: { '.env': DOTENV },
    declaration:
      path === 'workspace' ? WORKSPACE_DECLARATION : MANAGED_DECLARATION,
    images: imagesOf(documents, variables),
    sandboxRuntime: SANDBOX_RUNTIME,
    architecture: 'amd64',
    ...(path === 'workspace'
      ? { replicas: { platform: 2, 'backend-api': 2, 'backend-worker': 1 } }
      : {}),
    ...overrides,
  };
}

const GOLDEN_DIRECTORY = join(
  dirname(fileURLToPath(import.meta.url)),
  '__golden__',
);

/**
 * Hold `value` to `__golden__/<name>.json`. `TALE_UPDATE_GOLDEN=1` rewrites
 * the file instead (then `bun run format`); review its diff like any other
 * change.
 */
export function expectGolden(name: string, value: unknown): void {
  const file = join(GOLDEN_DIRECTORY, `${name}.json`);
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (process.env.TALE_UPDATE_GOLDEN === '1') {
    mkdirSync(GOLDEN_DIRECTORY, { recursive: true });
    writeFileSync(file, text);
    return;
  }
  expect(
    existsSync(file),
    `${file} is missing; run with TALE_UPDATE_GOLDEN=1`,
  ).toBe(true);
  // Parsed, so the formatter's layout of the file never matters.
  expect(value).toEqual(JSON.parse(readFileSync(file, 'utf8')));
}

/** One refusal of a service's `labels`: the Traefik edge reads them, and the
 * Incus runtime does not run that edge yet. */
function labelsRefusal(service: string): string {
  return `${service}.labels: "labels" is set; the routes it declares are read by the Traefik edge, which the Incus runtime does not run yet (tale-project/tale#5282), so the route would be served by nothing. ${REFUSAL_REASONS['refused-key']}`;
}

/** The Traefik edge's refusals of the stateful document, one line each as the
 * translator words them. The edge is refused fail-closed on the Incus
 * workspace path until the switch-role port lands. */
export const STATEFUL_EDGE_REFUSALS: readonly string[] = [
  labelsRefusal('object-store'),
  `proxy.networks: "docker-api" is no network of the stack. ${REFUSAL_REASONS.network}`,
  `docker-api.security_opt: "security_opt" is set; Incus takes no per-instance security options in a restricted project. ${REFUSAL_REASONS['refused-key']}`,
  `docker-api.volumes: "/var/run/docker.sock:/var/run/docker.sock:ro" mounts a host path. ${REFUSAL_REASONS['bind-mount']}`,
  `docker-api.volumes: The image declares the volume /data. ${REFUSAL_REASONS['image-volume-uncovered']}`,
  `docker-api.networks: "docker-api" is no network of the stack. ${REFUSAL_REASONS.network}`,
  labelsRefusal('sandbox'),
];

/** A colour's refusals: its platform and backend-api labels. Blue and green
 * name the same two services, so they carry the same two lines. */
export const COLOUR_EDGE_REFUSALS: readonly string[] = [
  labelsRefusal('platform'),
  labelsRefusal('backend-api'),
];

/** The stateful document and blue: nine refusals. */
export const STATEFUL_AND_BLUE_EDGE_REFUSALS: readonly string[] = [
  ...STATEFUL_EDGE_REFUSALS,
  ...COLOUR_EDGE_REFUSALS,
];

/** The stateful document and both colours: eleven refusals. */
export const STATEFUL_AND_BOTH_EDGE_REFUSALS: readonly string[] = [
  ...STATEFUL_AND_BLUE_EDGE_REFUSALS,
  ...COLOUR_EDGE_REFUSALS,
];

/** What `run` throws, or undefined when it returns. */
function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

/** The error `requireStackTarget` raises for `lines`: a precondition error,
 * held to its exit code, its summary, and every line of its cause. */
export function expectRefusalError(
  error: unknown,
  lines: readonly string[],
): void {
  expect(error).toBeInstanceOf(CliError);
  const info = (error as CliError).info;
  expect(info.code).toBe(ExitCode.Precondition);
  expect(info.summary).toBe(
    `The stack cannot run on Incus as declared (${lines.length} refusals).`,
  );
  expect(info.cause).toBe(lines.join('\n'));
}

/** Hold `result` to a refusal with exactly `lines`: no target, and the error a
 * caller of `requireStackTarget` gets. */
export function expectEdgeRefusal(
  result: CompileResult,
  lines: readonly string[],
): void {
  expect(result.target).toBeNull();
  expect(result.refusals).toHaveLength(lines.length);
  expectRefusalError(
    thrownBy(() => requireStackTarget(result)),
    lines,
  );
}

/** The sentence a managed prepare raises for the repository's own source,
 * whose edge is Traefik. */
export const MANAGED_EDGE_REFUSAL =
  'This revision runs its edge on Traefik, which the managed runtime cannot prepare yet (tale-project/tale#5282); select a v0.5 Tale revision.';

/** Hold a managed prepare's error to the Traefik edge's refusal. */
export function expectManagedEdgeRefusal(error: unknown): void {
  expect(error).toBeInstanceOf(CliError);
  expect((error as CliError).info.code).toBe(ExitCode.Precondition);
  expect((error as CliError).info.summary).toBe(MANAGED_EDGE_REFUSAL);
}
