import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { createModuleMocks } from '../../../utils/module-mock-fixture';
import { REQUIRED_VOLUMES } from '../../compose/generators/constants';
import type { DeploymentColor, ServiceName } from '../../compose/types';
import { MINIO_IMAGE, THIRD_PARTY_IMAGES } from '../../compose/types';
import { setProjectId } from '../../project/project-context';
import { getFlipPending, setFlipPending } from '../../state/flip-pending';
import { getCurrentColor } from '../../state/get-current-color';
import { setCurrentColor } from '../../state/set-current-color';
import {
  FakeRuntime,
  ISOLATED_TEST_VARIABLE,
  fakeDockerCli,
  runIsolatedTestFile,
} from '../fake-runtime';
import type { HealthState, InstanceMount } from '../types';
import { createDockerRuntime } from './docker-runtime';

/**
 * Bun's module mocks are process-wide, so everything that drives the real
 * `lib/docker` modules over the fake command line runs in a `bun test` of
 * its own (see `runIsolatedTestFile`).
 */
const isolated = process.env[ISOLATED_TEST_VARIABLE] === import.meta.path;

/**
 * The `docker` the suite's own process finds first on its `PATH`: what the
 * runtime spawns directly (log readers, the synchronous interrupt cleanup)
 * reaches it, and it writes each argv to `TALE_FAKE_DOCKER_LOG`.
 */
const FAKE_DOCKER = `#!/bin/sh
printf '%s\\n' "$*" >> "$TALE_FAKE_DOCKER_LOG"
case "$1" in
  ps) printf 'c0ffee000001\\nc0ffee000002\\n' ;;
  logs) echo "first line"; echo "second line" 1>&2; exit 3 ;;
  run)
    case "$*" in
      *" cat -- "*) printf 'archive bytes' ;;
      *"cat > "*) cat > "$TALE_FAKE_DOCKER_LOG.stdin" ;;
    esac ;;
esac
exit 0
`;

if (!isolated) {
  test('the Docker runtime suite passes in a process of its own', async () => {
    const bin = mkdtempSync(join(tmpdir(), 'tale-fake-docker-'));
    try {
      writeFileSync(join(bin, 'docker'), FAKE_DOCKER, { mode: 0o755 });
      const { exitCode, output } = await runIsolatedTestFile(import.meta.path, {
        PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
        TALE_FAKE_DOCKER_LOG: join(bin, 'calls.log'),
      });
      if (exitCode !== 0 || !/\b[1-9]\d* pass\b/.test(output))
        throw new Error(output);
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  }, 300_000);
} else {
  await isolatedSuite();
}

const PROJECT = 'demo-abc123';
const REGISTRY = 'ghcr.io/tale-project/tale';
const LIVE = '0.6.0';
const TARGET = '0.6.1';

/** One call the CLI made to the `docker` command line. */
interface RecordedCall {
  command: string;
  args: readonly string[];
  options: {
    cwd?: string;
    silent?: boolean;
    timeout?: number;
    maxOutputBytes?: number;
    env?: Record<string, string | undefined>;
    stdin?: string;
  };
}

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

/**
 * One line per call, with what differs between runs (temporary paths, the
 * clock, generated IDs) replaced by a name for it, and long scripts by their
 * digest so the record stays readable.
 */
function describeCalls(
  calls: readonly RecordedCall[],
  fake: FakeRuntime,
  deployDir: string,
): string[] {
  const normalize = (text: string): string => {
    // Windows hands Docker the directory with either separator; the record
    // holds one spelling.
    let value = text
      .replaceAll(deployDir, '<deploy-dir>')
      .replaceAll(deployDir.replaceAll('\\', '/'), '<deploy-dir>')
      .replaceAll('<deploy-dir>\\', '<deploy-dir>/')
      .replaceAll(/\.tale-deploy-compose-[0-9a-f-]{36}\.yml/g, '<compose>')
      .replaceAll(/\d{8}-\d{6}-(deploy|manual|start|update)/g, '<snapshot>')
      .replaceAll(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, '<time>')
      .replaceAll(/"cliVersion":"[^"]*"/g, '"cliVersion":"<cli>"');
    for (const [id, name] of fake.issuedIds) {
      value = value
        .replaceAll(id, `<${name}>`)
        .replaceAll(id.slice(0, 12), `<${name}>`);
    }
    return value;
  };
  return calls.map(({ command, args, options }) => {
    const words = [command, ...args].map((word) => {
      const value = normalize(word);
      return value.length > 100 ? `«${sha(value)}»` : value;
    });
    const extra = [
      options.cwd === undefined ? null : `cwd=${normalize(options.cwd)}`,
      options.silent ? 'silent' : null,
      options.timeout === undefined ? null : `timeout=${options.timeout}`,
      options.maxOutputBytes === undefined
        ? null
        : `max=${options.maxOutputBytes}`,
      options.env === undefined ? null : 'env',
      options.stdin === undefined
        ? null
        : `stdin=${sha(normalize(options.stdin))}`,
    ].filter((entry) => entry !== null);
    return extra.length === 0
      ? words.join(' ')
      : `${words.join(' ')} | ${extra.join(' ')}`;
  });
}

function volume(name: string, target: string, readOnly = false): InstanceMount {
  return { kind: 'volume', source: `${PROJECT}_${name}`, target, readOnly };
}

/** The label an image carries once its backend process serves the app. */
const APP_IN_BACKEND = { 'io.tale.app-in-backend': '1' };

const platformImage = (version: string): string =>
  `${REGISTRY}/tale-platform:${version}`;

/** A host that runs `LIVE` on the blue colour: the stateful tier, the
 *  sidecar, the model gateway an earlier release ran (which a deploy
 *  retires, retire-gateway.ts) and one replica of each colour role. */
function seedLiveBlue(fake: FakeRuntime): void {
  seedStateful(fake);
  seedColour(fake, 'blue', LIVE, 'three-way');
}

/** The stateful tier, the sidecar and the model gateway with its store, at
 *  `LIVE`. */
function seedStateful(fake: FakeRuntime): void {
  for (const name of REQUIRED_VOLUMES) fake.seedVolume(`${PROJECT}_${name}`);
  fake.seedVolume(`${PROJECT}_llm-gateway-data`);
  // A deployment of today: its blobs are in MinIO's volume, in MinIO's
  // format, and versitygw's exists and holds nothing.
  fake.seedVolume(`${PROJECT}_object-store-data`, {
    '.minio.sys/format.json': '{}',
  });
  fake.seedNetwork(`${PROJECT}_internal`);
  fake.seedNetwork('tale-sandbox-net', { internal: true, ipv6: false });
  const stateful: Array<[string, string, InstanceMount[], HealthState]> = [
    [
      'db',
      'tale-db',
      [volume('db-data', '/var/lib/postgresql/data')],
      'healthy',
    ],
    [
      'object-store',
      'tale-object-store',
      [volume('object-store-data', '/data')],
      'healthy',
    ],
    [
      'proxy',
      'tale-proxy',
      [volume('caddy-data', '/data'), volume('caddy-config', '/config')],
      'healthy',
    ],
    [
      'sandbox-llm-gateway',
      'tale-sandbox-llm-gateway',
      [volume('llm-gateway-data', '/app/data')],
      'healthy',
    ],
    ['sandbox', 'tale-sandbox', [], 'healthy'],
    ['sandbox-egress', 'tale-sandbox-egress', [], 'healthy'],
    ['bgutil-provider', 'tale-bgutil', [], 'none'],
  ];
  for (const [service, image, mounts, health] of stateful)
    fake.seedInstance({
      name: `${PROJECT}-${service}`,
      stack: PROJECT,
      service,
      image: `${REGISTRY}/${image}:${LIVE}`,
      mounts,
      health,
      environment:
        service === 'db'
          ? { DB_USER: 'tale', POSTGRES_PASSWORD: 'synthetic-db-secret' }
          : {},
    });
}

/**
 * One colour at `version`, one replica of each service its shape has: the
 * three services, `platform` as the whole application (`unified`), or
 * `platform` as the API and the pages with the job runners apart (`split`).
 */
function seedColour(
  fake: FakeRuntime,
  colour: DeploymentColor,
  version: string,
  shape: 'three-way' | 'unified' | 'split',
): void {
  const database = {
    DATABASE_URL: 'postgresql://tale:synthetic@db:5432/tale_app',
  };
  const stack = `${PROJECT}-${colour}`;
  const image = platformImage(version);
  if (shape === 'three-way') {
    fake.seedInstance({
      stack,
      service: 'platform',
      image,
      mounts: [volume('config-data', '/app/data', true)],
      networks: [`${PROJECT}_internal`],
    });
    fake.seedInstance({
      stack,
      service: 'backend-api',
      image,
      mounts: [volume('config-data', '/app/data')],
      networks: [`${PROJECT}_internal`, 'tale-sandbox-net'],
      environment: database,
    });
  } else {
    fake.seedInstance({
      stack,
      service: 'platform',
      image,
      mounts: [volume('config-data', '/app/data')],
      networks: [`${PROJECT}_internal`, 'tale-sandbox-net'],
      environment: {
        ...database,
        TALE_ROLE: shape === 'unified' ? 'all' : 'api',
      },
    });
  }
  if (shape !== 'unified')
    fake.seedInstance({
      stack,
      service: 'backend-worker',
      image,
      mounts: [volume('config-data', '/app/data')],
      networks: [`${PROJECT}_internal`],
      health: 'none',
      environment: { ...database, TALE_ROLE: 'worker' },
    });
}

/**
 * What a blue → green deploy of `TARGET` over a host running `LIVE` asks
 * Docker, in order. Recorded from the CLI before the runtime interface
 * existed (main at 4368a0fb6), so it proves the Docker runtime sends
 * the same commands the actions sent themselves. A change that alters this on
 * purpose regenerates it: run this file with `TALE_DEPLOY_ARGV_CAPTURE=<file>`
 * (and `TALE_RUNTIME_ISOLATED_TEST` set to its path) and review the diff.
 */
const BLUE_GREEN_DEPLOY_ARGV: readonly string[] = [
  'docker ps -a --no-trunc --filter label=com.docker.compose.project=demo-abc123 --filter label=com.docker.compose.service=db --format {{.ID}} | silent timeout=15 max=1048576 env',
  'docker ps -a --no-trunc --filter label=com.docker.compose.project=demo-abc123 --format {{.ID}}\t{{.Label "com.docker.compose.service"}} | silent timeout=15 max=1048576 env',
  'docker ps -a --no-trunc --filter label=com.docker.compose.project=demo-abc123-blue --format {{.ID}}\t{{.Label "com.docker.compose.service"}} | silent timeout=15 max=1048576 env',
  'docker ps -a --no-trunc --filter label=com.docker.compose.project=demo-abc123-green --format {{.ID}}\t{{.Label "com.docker.compose.service"}} | silent timeout=15 max=1048576 env',
  'docker container inspect <demo-abc123-blue-platform-1> | silent timeout=15 max=1048576 env',
  'docker container inspect <demo-abc123-blue-backend-api-1> <demo-abc123-blue-backend-worker-1> | silent timeout=15 max=1048576 env',
  'docker image inspect sha256:<image ghcr.io/tale-project/tale/tale-platform:0.6.0> | silent timeout=15 max=1048576 env',
  'docker container inspect <demo-abc123-db> | silent timeout=15 max=1048576 env',
  'docker exec -i <demo-abc123-db> sh -s | silent timeout=15 max=1048576 env stdin=b09c49e4fe79',
  'docker container inspect <demo-abc123-db> | silent timeout=15 max=1048576 env',
  'docker ps -a --no-trunc --filter label=com.docker.compose.project=demo-abc123 --format {{.ID}}\t{{.Label "com.docker.compose.service"}} | silent timeout=15 max=1048576 env',
  'docker ps -a --no-trunc --filter label=com.docker.compose.project=demo-abc123-blue --format {{.ID}}\t{{.Label "com.docker.compose.service"}} | silent timeout=15 max=1048576 env',
  'docker ps -a --no-trunc --filter label=com.docker.compose.project=demo-abc123-green --format {{.ID}}\t{{.Label "com.docker.compose.service"}} | silent timeout=15 max=1048576 env',
  'docker container inspect <demo-abc123-blue-platform-1> | silent timeout=15 max=1048576 env',
  'docker container inspect <demo-abc123-blue-backend-api-1> <demo-abc123-blue-backend-worker-1> | silent timeout=15 max=1048576 env',
  'docker image inspect sha256:<image ghcr.io/tale-project/tale/tale-platform:0.6.0> | silent timeout=15 max=1048576 env',
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123-blue --filter label=com.docker.compose.service=platform --format \u00ab4fc2b80a78e6\u00bb',
  'docker container inspect --format \u00ab981aa748b02d\u00bb demo-abc123-blue-platform-1',
  'docker container inspect --format {{.State.Running}} demo-abc123-db',
  'docker container inspect --format {{.State.Running}} demo-abc123-object-store',
  'docker container inspect --format {{.State.Running}} demo-abc123-proxy',
  'docker container inspect --format {{.State.Running}} demo-abc123-docker-api',
  // Which blob store the deployment runs, read from its volumes before the
  // pull (docker/resolve-object-store.ts): MinIO, whose volume holds blobs.
  'docker volume inspect demo-abc123_blob-data',
  'docker run --rm -v demo-abc123_blob-data:/data:ro alpine:3.22 sh -c find /data -mindepth 1 -maxdepth 1 ! -name lost+found -print -quit',
  'docker volume inspect demo-abc123_object-store-data',
  'docker run --rm -v demo-abc123_object-store-data:/data:ro alpine:3.22 sh -c find /data -mindepth 1 -maxdepth 1 ! -name lost+found -print -quit',
  'docker info --format {{.CgroupVersion}} | silent timeout=10',
  'docker pull ghcr.io/tale-project/tale/tale-platform:0.6.1',
  'docker pull ghcr.io/tale-project/tale/tale-sandbox:0.6.1',
  'docker pull ghcr.io/tale-project/tale/tale-sandbox-egress:0.6.1',
  'docker pull ghcr.io/tale-project/tale/tale-proxy:0.6.1',
  'docker pull ghcr.io/tale-project/tale/tale-sandbox-runtime:0.6.1',
  'docker pull ghcr.io/tale-project/tale/tale-sandbox-buildkitd:0.6.1',
  'docker image inspect ghcr.io/tale-project/tale/tale-platform:0.6.1 | silent timeout=15 max=1048576 env',
  'docker image inspect ghcr.io/tale-project/tale/tale-platform:0.6.1 | silent timeout=15 max=1048576 env',
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123-green --filter label=com.docker.compose.service=platform --format \u00ab4fc2b80a78e6\u00bb',
  'docker ps -a --no-trunc --filter label=com.docker.compose.project=demo-abc123 --filter label=com.docker.compose.service=db --format {{.ID}} | silent timeout=15 max=1048576 env',
  'docker ps -a --no-trunc --filter label=com.docker.compose.project=demo-abc123 --format {{.ID}}\t{{.Label "com.docker.compose.service"}} | silent timeout=15 max=1048576 env',
  'docker ps -a --no-trunc --filter label=com.docker.compose.project=demo-abc123-blue --format {{.ID}}\t{{.Label "com.docker.compose.service"}} | silent timeout=15 max=1048576 env',
  'docker ps -a --no-trunc --filter label=com.docker.compose.project=demo-abc123-green --format {{.ID}}\t{{.Label "com.docker.compose.service"}} | silent timeout=15 max=1048576 env',
  'docker container inspect <demo-abc123-blue-platform-1> | silent timeout=15 max=1048576 env',
  'docker container inspect <demo-abc123-blue-backend-api-1> <demo-abc123-blue-backend-worker-1> | silent timeout=15 max=1048576 env',
  'docker image inspect sha256:<image ghcr.io/tale-project/tale/tale-platform:0.6.0> | silent timeout=15 max=1048576 env',
  'docker container inspect <demo-abc123-db> | silent timeout=15 max=1048576 env',
  'docker exec -i <demo-abc123-db> sh -s | silent timeout=15 max=1048576 env stdin=b09c49e4fe79',
  'docker container inspect <demo-abc123-db> | silent timeout=15 max=1048576 env',
  'docker ps -a --no-trunc --filter label=com.docker.compose.project=demo-abc123 --format {{.ID}}\t{{.Label "com.docker.compose.service"}} | silent timeout=15 max=1048576 env',
  'docker ps -a --no-trunc --filter label=com.docker.compose.project=demo-abc123-blue --format {{.ID}}\t{{.Label "com.docker.compose.service"}} | silent timeout=15 max=1048576 env',
  'docker ps -a --no-trunc --filter label=com.docker.compose.project=demo-abc123-green --format {{.ID}}\t{{.Label "com.docker.compose.service"}} | silent timeout=15 max=1048576 env',
  'docker container inspect <demo-abc123-blue-platform-1> | silent timeout=15 max=1048576 env',
  'docker container inspect <demo-abc123-blue-backend-api-1> <demo-abc123-blue-backend-worker-1> | silent timeout=15 max=1048576 env',
  'docker image inspect sha256:<image ghcr.io/tale-project/tale/tale-platform:0.6.0> | silent timeout=15 max=1048576 env',
  'docker tag ghcr.io/tale-project/tale/tale-sandbox-runtime:0.6.1 tale-sandbox-runtime:latest',
  'docker tag ghcr.io/tale-project/tale/tale-sandbox-buildkitd:0.6.1 tale-sandbox-buildkitd:latest',
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123-blue --filter label=com.docker.compose.service=platform --format \u00ab4fc2b80a78e6\u00bb',
  'docker container inspect --format \u00ab981aa748b02d\u00bb demo-abc123-blue-platform-1',
  'docker volume inspect demo-abc123_config-data',
  'docker run --rm -v demo-abc123_config-data:/data:ro alpine:3.22 sh -c \u00abaafa04e7f34c\u00bb',
  'docker volume inspect demo-abc123_db-data',
  'docker volume inspect demo-abc123_knowledge-db-data',
  'docker volume inspect demo-abc123_config-data',
  // Which volume the blobs are in (backup/live-blob-volume.ts): versitygw's
  // holds nothing and MinIO's does, so the snapshot archives MinIO's, as it
  // did.
  'docker volume inspect demo-abc123_blob-data',
  'docker run --rm -v demo-abc123_blob-data:/data:ro alpine:3.22 sh -c find /data -mindepth 1 -maxdepth 1 ! -name lost+found -print -quit',
  'docker volume inspect demo-abc123_object-store-data',
  'docker run --rm -v demo-abc123_object-store-data:/data:ro alpine:3.22 sh -c find /data -mindepth 1 -maxdepth 1 ! -name lost+found -print -quit',
  'docker volume inspect demo-abc123_object-store-data',
  'docker volume inspect demo-abc123_caddy-data',
  'docker volume inspect demo-abc123_caddy-config',
  'docker volume inspect demo-abc123_proxy-data',
  'docker volume inspect demo-abc123_backups',
  'docker volume create --label project=demo-abc123 demo-abc123_backups',
  'docker ps -q --filter volume=demo-abc123_db-data',
  'docker ps -q --filter volume=demo-abc123_config-data',
  'docker ps -q --filter volume=demo-abc123_object-store-data',
  'docker ps -q --filter volume=demo-abc123_caddy-data',
  'docker ps -q --filter volume=demo-abc123_caddy-config',
  'docker ps -q --filter volume=demo-abc123_proxy-data',
  'docker ps -q --filter volume=demo-abc123_db-data',
  'docker container inspect --format \u00ab91a7d366815f\u00bb <demo-abc123-db>',
  'docker pause <demo-abc123-db>',
  'docker run --rm -v demo-abc123_db-data:/data:ro -v demo-abc123_backups:/backup alpine:3.22 sh -c \u00ab8603259a0f21\u00bb | timeout=1800',
  'docker unpause <demo-abc123-db>',
  'docker container inspect --format \u00ab91a7d366815f\u00bb <demo-abc123-db>',
  'docker ps -q --filter volume=demo-abc123_config-data',
  'docker container inspect --format \u00ab91a7d366815f\u00bb <demo-abc123-blue-platform-1>',
  'docker container inspect --format \u00ab91a7d366815f\u00bb <demo-abc123-blue-backend-api-1>',
  'docker container inspect --format \u00ab91a7d366815f\u00bb <demo-abc123-blue-backend-worker-1>',
  'docker pause <demo-abc123-blue-platform-1>',
  'docker pause <demo-abc123-blue-backend-api-1>',
  'docker pause <demo-abc123-blue-backend-worker-1>',
  'docker run --rm -v demo-abc123_config-data:/data:ro -v demo-abc123_backups:/backup alpine:3.22 sh -c \u00ab398aa8c5f07f\u00bb | timeout=1800',
  'docker unpause <demo-abc123-blue-platform-1>',
  'docker unpause <demo-abc123-blue-backend-api-1>',
  'docker unpause <demo-abc123-blue-backend-worker-1>',
  'docker container inspect --format \u00ab91a7d366815f\u00bb <demo-abc123-blue-platform-1>',
  'docker container inspect --format \u00ab91a7d366815f\u00bb <demo-abc123-blue-backend-api-1>',
  'docker ps -q --filter volume=demo-abc123_object-store-data',
  'docker container inspect --format \u00ab91a7d366815f\u00bb <demo-abc123-object-store>',
  'docker pause <demo-abc123-object-store>',
  'docker run --rm -v demo-abc123_object-store-data:/data:ro -v demo-abc123_backups:/backup alpine:3.22 sh -c \u00abe85a90bc6f2a\u00bb | timeout=14400',
  'docker unpause <demo-abc123-object-store>',
  'docker container inspect --format \u00ab91a7d366815f\u00bb <demo-abc123-object-store>',
  'docker ps -q --filter volume=demo-abc123_caddy-data',
  'docker ps -q --filter volume=demo-abc123_caddy-config',
  'docker container inspect --format \u00ab91a7d366815f\u00bb <demo-abc123-proxy>',
  'docker pause <demo-abc123-proxy>',
  'docker run --rm -v demo-abc123_caddy-data:/data:ro -v demo-abc123_backups:/backup alpine:3.22 sh -c \u00abe7bf9fe30ec4\u00bb | timeout=1800',
  'docker run --rm -v demo-abc123_caddy-config:/data:ro -v demo-abc123_backups:/backup alpine:3.22 sh -c \u00aba33565f6eac3\u00bb | timeout=1800',
  'docker unpause <demo-abc123-proxy>',
  'docker container inspect --format \u00ab91a7d366815f\u00bb <demo-abc123-proxy>',
  'docker ps -q --filter volume=demo-abc123_proxy-data',
  'docker run --rm -v demo-abc123_proxy-data:/data:ro -v demo-abc123_backups:/backup alpine:3.22 sh -c \u00abc829dad8b2b6\u00bb | timeout=1800',
  'docker run --rm -i -v demo-abc123_backups:/backup alpine:3.22 sh -c cat > /backup/<snapshot>/manifest.json | stdin=fb794fda1b78',
  'docker volume inspect demo-abc123_backups',
  'docker run --rm -v demo-abc123_backups:/backup:ro alpine:3.22 sh -c for f in /backup/*/manifest.json; do [ -f "$f" ] && cat "$f" && echo; done; true',
  'docker run --rm -v demo-abc123_backups:/backup:ro alpine:3.22 sh -c for d in /backup/*/; do [ -f "${d}manifest.json" ] || basename "$d"; done; true',
  'docker ps -a --no-trunc --filter label=com.docker.compose.project=demo-abc123 --filter label=com.docker.compose.service=db --format {{.ID}} | silent timeout=15 max=1048576 env',
  'docker ps -a --no-trunc --filter label=com.docker.compose.project=demo-abc123 --format {{.ID}}\t{{.Label "com.docker.compose.service"}} | silent timeout=15 max=1048576 env',
  'docker ps -a --no-trunc --filter label=com.docker.compose.project=demo-abc123-blue --format {{.ID}}\t{{.Label "com.docker.compose.service"}} | silent timeout=15 max=1048576 env',
  'docker ps -a --no-trunc --filter label=com.docker.compose.project=demo-abc123-green --format {{.ID}}\t{{.Label "com.docker.compose.service"}} | silent timeout=15 max=1048576 env',
  'docker container inspect <demo-abc123-blue-platform-1> | silent timeout=15 max=1048576 env',
  'docker container inspect <demo-abc123-blue-backend-api-1> <demo-abc123-blue-backend-worker-1> | silent timeout=15 max=1048576 env',
  'docker image inspect sha256:<image ghcr.io/tale-project/tale/tale-platform:0.6.0> | silent timeout=15 max=1048576 env',
  'docker container inspect <demo-abc123-db> | silent timeout=15 max=1048576 env',
  'docker exec -i <demo-abc123-db> sh -s | silent timeout=15 max=1048576 env stdin=b09c49e4fe79',
  'docker container inspect <demo-abc123-db> | silent timeout=15 max=1048576 env',
  'docker ps -a --no-trunc --filter label=com.docker.compose.project=demo-abc123 --format {{.ID}}\t{{.Label "com.docker.compose.service"}} | silent timeout=15 max=1048576 env',
  'docker ps -a --no-trunc --filter label=com.docker.compose.project=demo-abc123-blue --format {{.ID}}\t{{.Label "com.docker.compose.service"}} | silent timeout=15 max=1048576 env',
  'docker ps -a --no-trunc --filter label=com.docker.compose.project=demo-abc123-green --format {{.ID}}\t{{.Label "com.docker.compose.service"}} | silent timeout=15 max=1048576 env',
  'docker container inspect <demo-abc123-blue-platform-1> | silent timeout=15 max=1048576 env',
  'docker container inspect <demo-abc123-blue-backend-api-1> <demo-abc123-blue-backend-worker-1> | silent timeout=15 max=1048576 env',
  'docker image inspect sha256:<image ghcr.io/tale-project/tale/tale-platform:0.6.0> | silent timeout=15 max=1048576 env',
  'docker volume inspect demo-abc123_config-data',
  'docker run --rm -v demo-abc123_config-data:/data:ro alpine:3.22 sh -c find /data -mindepth 1 -maxdepth 1 ! -name lost+found -print -quit',
  'docker volume inspect demo-abc123_static-assets',
  'docker volume inspect demo-abc123_platform-data',
  'docker volume inspect demo-abc123_convex-data',
  'docker volume inspect demo-abc123_config-data',
  'docker volume inspect demo-abc123_caddy-data',
  'docker volume inspect demo-abc123_caddy-config',
  'docker volume inspect demo-abc123_proxy-data',
  'docker volume inspect demo-abc123_db-data',
  'docker volume inspect demo-abc123_db-backup',
  'docker volume inspect demo-abc123_blob-data',
  'docker volume inspect demo-abc123_object-store-data',
  'docker network inspect demo-abc123_internal',
  'docker network inspect tale-sandbox-net',
  'docker network inspect --format {{.Internal}}|{{.EnableIPv6}} tale-sandbox-net',
  'docker network inspect --format {{range .IPAM.Config}}{{.Subnet}} {{end}} tale-sandbox-net',
  'docker container inspect --format \u00ab981aa748b02d\u00bb demo-abc123-sandbox',
  'docker container inspect --format {{.State.Running}} demo-abc123-sandbox',
  'docker exec demo-abc123-sandbox sh -c \u00ab5bbd5d50106f\u00bb',
  'docker exec demo-abc123-sandbox sh -c \u00ab9fd85dd96812\u00bb',
  'docker compose -p demo-abc123 -f <deploy-dir>/<compose> up -d sandbox sandbox-egress docker-api | cwd=<deploy-dir>',
  'docker container inspect --format {{.State.Running}} demo-abc123-sandbox',
  'docker container inspect --format {{.State.Health.Status}} demo-abc123-sandbox',
  'docker container inspect --format {{.State.Running}} demo-abc123-sandbox-egress',
  'docker container inspect --format {{.State.Health.Status}} demo-abc123-sandbox-egress',
  'docker container inspect --format {{.State.Running}} demo-abc123-docker-api',
  'docker container inspect --format {{.State.Health.Status}} demo-abc123-docker-api',
  'docker container inspect --format {{.Id}} demo-abc123-bgutil-provider',
  'docker rm -f demo-abc123-bgutil-provider',
  // The model gateway an earlier release ran (actions/retire-gateway.ts):
  // the live backend says no key it minted is open, so its container goes,
  // and the removal hint reads its store, which stays.
  'docker container inspect --format {{.Id}} demo-abc123-sandbox-llm-gateway',
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123-blue --filter label=com.docker.compose.service=backend-api --format \u00ab4fc2b80a78e6\u00bb',
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123-green --filter label=com.docker.compose.service=backend-api --format \u00ab4fc2b80a78e6\u00bb',
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123-green --filter label=com.docker.compose.service=platform --format \u00ab4fc2b80a78e6\u00bb',
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123 --filter label=com.docker.compose.service=backend-api --format \u00ab4fc2b80a78e6\u00bb',
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123 --filter label=com.docker.compose.service=platform --format \u00ab4fc2b80a78e6\u00bb',
  'docker exec demo-abc123-blue-backend-api-1 sh -c \u00ab8430a89baf50\u00bb',
  'docker rm -f demo-abc123-sandbox-llm-gateway',
  'docker volume inspect demo-abc123_llm-gateway-data',
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123-blue --filter label=com.docker.compose.service=platform --format \u00ab4fc2b80a78e6\u00bb',
  'docker container inspect --format \u00ab981aa748b02d\u00bb demo-abc123-blue-platform-1',
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123-green --format \u00ab4fc2b80a78e6\u00bb',
  'docker compose -p demo-abc123-green -f <deploy-dir>/<compose> up -d --scale platform=1 --scale backend-api=1 --scale backend-worker=1 platform backend-api backend-worker | cwd=<deploy-dir>',
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123-green --filter label=com.docker.compose.service=platform --format \u00ab4fc2b80a78e6\u00bb',
  'docker container inspect --format {{.State.Running}} demo-abc123-green-platform-1',
  'docker container inspect --format {{.State.Health.Status}} demo-abc123-green-platform-1',
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123-green --filter label=com.docker.compose.service=backend-api --format \u00ab4fc2b80a78e6\u00bb',
  'docker container inspect --format {{.State.Running}} demo-abc123-green-backend-api-1',
  'docker container inspect --format {{.State.Health.Status}} demo-abc123-green-backend-api-1',
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123-green --filter label=com.docker.compose.service=backend-worker --format \u00ab4fc2b80a78e6\u00bb',
  'docker container inspect --format {{.State.Running}} demo-abc123-green-backend-worker-1',
  'docker container inspect --format {{.State.Health.Status}} demo-abc123-green-backend-worker-1',
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123 --filter label=com.docker.compose.service=backend-api --format \u00ab4fc2b80a78e6\u00bb',
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123 --filter label=com.docker.compose.service=backend-api --format \u00ab4fc2b80a78e6\u00bb',
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123 --filter label=com.docker.compose.service=backend-worker --format \u00ab4fc2b80a78e6\u00bb',
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123-green --filter label=com.docker.compose.service=backend-api --format \u00ab4fc2b80a78e6\u00bb',
  'docker exec -i demo-abc123-green-backend-api-1 sh -c \u00aba8e24830aaf9\u00bb | stdin=0432367cd6be',
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123-blue --filter label=com.docker.compose.service=backend-api --format \u00ab4fc2b80a78e6\u00bb',
  'docker exec demo-abc123-green-backend-api-1 sh -c \u00ab27e9759cf72a\u00bb',
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123-blue --filter label=com.docker.compose.service=platform --format \u00ab4fc2b80a78e6\u00bb',
  'docker network disconnect demo-abc123_internal demo-abc123-blue-platform-1',
  'docker network disconnect tale-sandbox-net demo-abc123-blue-platform-1',
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123-blue --filter label=com.docker.compose.service=backend-api --format \u00ab4fc2b80a78e6\u00bb',
  'docker network disconnect demo-abc123_internal demo-abc123-blue-backend-api-1',
  'docker network disconnect tale-sandbox-net demo-abc123-blue-backend-api-1',
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123-blue --format \u00ab4fc2b80a78e6\u00bb',
  'docker stop demo-abc123-blue-backend-api-1',
  'docker stop demo-abc123-blue-backend-worker-1',
  'docker stop demo-abc123-blue-platform-1',
  'docker rm -f demo-abc123-blue-backend-api-1',
  'docker rm -f demo-abc123-blue-backend-worker-1',
  'docker rm -f demo-abc123-blue-platform-1',
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123-blue --filter label=com.docker.compose.service=backend-api --format \u00ab4fc2b80a78e6\u00bb',
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123-blue --filter label=com.docker.compose.service=platform --format \u00ab4fc2b80a78e6\u00bb',
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123-green --filter label=com.docker.compose.service=backend-api --format \u00ab4fc2b80a78e6\u00bb',
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123 --filter label=com.docker.compose.service=backend-api --format \u00ab4fc2b80a78e6\u00bb',
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123 --filter label=com.docker.compose.service=platform --format \u00ab4fc2b80a78e6\u00bb',
  'docker exec demo-abc123-green-backend-api-1 sh -c \u00abcf4507e58178\u00bb',
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123-blue --filter label=com.docker.compose.service=backend-api --format \u00ab4fc2b80a78e6\u00bb',
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123-blue --filter label=com.docker.compose.service=platform --format \u00ab4fc2b80a78e6\u00bb',
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123-green --filter label=com.docker.compose.service=backend-api --format \u00ab4fc2b80a78e6\u00bb',
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123 --filter label=com.docker.compose.service=backend-api --format \u00ab4fc2b80a78e6\u00bb',
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123 --filter label=com.docker.compose.service=platform --format \u00ab4fc2b80a78e6\u00bb',
];

/** The fake `docker` on the `PATH` is a POSIX shell script. */
const testPosix = test.skipIf(process.platform === 'win32');

async function isolatedSuite(): Promise<void> {
  // Even in a process of its own, the replaced command line goes back once
  // the suite ends.
  const { mockModule } = createModuleMocks(import.meta.dir);
  let fake = new FakeRuntime();
  let cli = fakeDockerCli(fake);
  let calls: RecordedCall[] = [];
  /** A call the daemon refuses, for one test: true for the argv to fail. */
  let refuses: (args: readonly string[]) => boolean = () => false;
  /** The move of the blobs from MinIO, which its own tests hold
   * (docker/migrate-blob-store.test.ts): here, what the deploy hands it and
   * does with its answer. */
  type Move = typeof import('../../docker/migrate-blob-store').migrateBlobStore;
  let moves: Parameters<Move>[0][] = [];
  let move: Move = async () => ({ moved: false, reason: 'not asked' });
  await mockModule('../../docker/migrate-blob-store', () => ({
    migrateBlobStore: (...args: Parameters<Move>) => {
      moves.push(args[0]);
      return move(...args);
    },
  }));
  await mockModule('../../docker/exec', () => ({
    exec: async (
      command: string,
      args: string[],
      options: RecordedCall['options'] = {},
    ) => {
      calls.push({ command, args: [...args], options });
      if (refuses(args))
        return {
          success: false,
          exitCode: 1,
          stdout: '',
          stderr: 'Error response from daemon: synthetic refusal',
        };
      return cli(command, args, options);
    },
  }));

  let deployDir = '';
  beforeEach(() => {
    fake = new FakeRuntime();
    cli = fakeDockerCli(fake);
    calls = [];
    refuses = () => false;
    moves = [];
    move = async () => ({ moved: false, reason: 'not asked' });
    deployDir = mkdtempSync(join(tmpdir(), 'tale-runtime-argv-'));
    setProjectId(PROJECT);
    delete process.env.DATABASE_URL;
    delete process.env.APP_DB_NAME;
  });
  afterEach(() => {
    rmSync(deployDir, { recursive: true, force: true });
  });

  describe('a blue/green deploy asks Docker what it asked before the runtime interface', () => {
    test('the recorded argv of a full flip is unchanged', async () => {
      const { deploy } = await import('../../actions/deploy');
      seedLiveBlue(fake);
      writeFileSync(
        join(deployDir, 'tale.json'),
        JSON.stringify({
          version: 1,
          cliVersion: TARGET,
          createdAt: '2026-11-12T00:00:00.000Z',
          id: PROJECT,
        }),
      );
      await setCurrentColor(deployDir, 'blue');

      await deploy({
        version: TARGET,
        stop: false,
        env: {
          GHCR_REGISTRY: REGISTRY,
          SITE_URL: 'https://localhost',
          HEALTH_CHECK_TIMEOUT: 1,
          DRAIN_TIMEOUT: 0,
          DEPLOY_DIR: deployDir,
        },
        hostAlias: 'localhost',
        dryRun: false,
        quiet: true,
      });

      // The flip happened: green runs the target, blue is gone.
      expect(await getCurrentColor(deployDir)).toBe('green');
      expect(
        (await fake.list({ stack: `${PROJECT}-green` })).map(
          (instance) => instance.service,
        ),
      ).toEqual(['backend-api', 'backend-worker', 'platform']);
      expect(await fake.list({ stack: `${PROJECT}-blue` })).toEqual([]);
      expect(await fake.version(`${PROJECT}-green-platform-1`)).toBe(TARGET);

      const recorded = describeCalls(calls, fake, deployDir);
      const capture = process.env.TALE_DEPLOY_ARGV_CAPTURE;
      if (capture)
        writeFileSync(capture, `${JSON.stringify(recorded, null, 2)}\n`);
      expect(recorded).toEqual([...BLUE_GREEN_DEPLOY_ARGV]);

      // The order that keeps a flip from cutting requests (design 7.3,
      // R3-34): Docker's withdrawal cuts live connections, so the old
      // colour is drained before it is disconnected, and stopped after.
      const where = (match: (args: readonly string[]) => boolean) =>
        calls.flatMap((call, index) => (match(call.args) ? [index] : []));
      const drains = where((args) =>
        args.some((word) => /\/api\/control\/drain(-status)?\b/.test(word)),
      );
      const disconnects = where(
        (args) => args[0] === 'network' && args[1] === 'disconnect',
      );
      const stops = where((args) => args[0] === 'stop');
      expect(drains.length).toBeGreaterThan(0);
      expect(disconnects.length).toBeGreaterThan(0);
      expect(Math.max(...drains)).toBeLessThan(Math.min(...disconnects));
      expect(Math.max(...disconnects)).toBeLessThan(Math.min(...stops));
      expect(readFileSync(join(deployDir, 'tale.json'), 'utf8')).toContain(
        PROJECT,
      );
    });
  });

  describe('a colour takes the shape its image runs', () => {
    const NEXT = '0.6.2';
    const BACKEND_REPLICAS = [
      'TALE_PLATFORM_REPLICAS',
      'TALE_BACKEND_API_REPLICAS',
      'TALE_BACKEND_WORKER_REPLICAS',
      'TALE_APP_TIER',
      'DB_PROFILE',
      'VIDEO_INGEST_POT_PROVIDER',
    ];
    let asked: Record<string, string | undefined> = {};
    beforeEach(() => {
      asked = Object.fromEntries(
        BACKEND_REPLICAS.map((name) => [name, process.env[name]]),
      );
      for (const name of BACKEND_REPLICAS) delete process.env[name];
    });
    afterEach(() => {
      for (const name of BACKEND_REPLICAS) {
        if (asked[name] === undefined) delete process.env[name];
        else process.env[name] = asked[name];
      }
    });

    const workspace = async (live: DeploymentColor): Promise<void> => {
      writeFileSync(
        join(deployDir, 'tale.json'),
        JSON.stringify({
          version: 1,
          cliVersion: TARGET,
          createdAt: '2026-11-12T00:00:00.000Z',
          id: PROJECT,
        }),
      );
      await setCurrentColor(deployDir, live);
    };
    const run = async (
      version: string,
      options: { services?: ServiceName[] } = {},
    ): Promise<void> => {
      const { deploy } = await import('../../actions/deploy');
      await deploy({
        version,
        stop: false,
        env: {
          GHCR_REGISTRY: REGISTRY,
          SITE_URL: 'https://localhost',
          HEALTH_CHECK_TIMEOUT: 1,
          DRAIN_TIMEOUT: 0,
          DEPLOY_DIR: deployDir,
        },
        hostAlias: 'localhost',
        dryRun: false,
        quiet: true,
        skipBackup: true,
        ...options,
      });
    };
    /** `platform`, `backend-worker`, …: one entry per replica of a colour. */
    const servicesOf = async (colour: DeploymentColor): Promise<string[]> =>
      (await fake.list({ stack: `${PROJECT}-${colour}` })).map(
        (instance) => instance.service,
      );
    const environmentOf = (name: string): Record<string, string> =>
      fake.instances.get(name)?.environment ?? {};
    /** What each `compose up` of a colour asked for, after `up -d`. */
    const upsOf = (colour: DeploymentColor): string[] =>
      calls.flatMap(({ args }) => {
        const up = args.indexOf('up');
        return args[0] === 'compose' &&
          args.includes(`${PROJECT}-${colour}`) &&
          up > 0
          ? [args.slice(up + 2).join(' ')]
          : [];
      });
    /** The replicas a call to the drain door was sent into. */
    const drainedThrough = (): string[] =>
      calls.flatMap(({ args }) =>
        args[0] === 'exec' &&
        args.some((word) => /\/api\/control\/drain(?!-status)\b/.test(word))
          ? [args.find((word) => word.startsWith(`${PROJECT}-`)) ?? '']
          : [],
      );

    test('an image that serves the app from its backend process comes up as one platform, beside a colour of three services', async () => {
      seedLiveBlue(fake);
      fake.seedImage(platformImage(TARGET), APP_IN_BACKEND);
      await workspace('blue');

      await run(TARGET);

      expect(await getCurrentColor(deployDir)).toBe('green');
      expect(await servicesOf('green')).toEqual(['platform']);
      expect(await servicesOf('blue')).toEqual([]);
      expect(upsOf('green')).toEqual(['--scale platform=1 platform']);
      const platform = `${PROJECT}-green-platform-1`;
      expect(environmentOf(platform).TALE_ROLE).toBe('all');
      expect(environmentOf(platform).PORT).toBe('3005');
      expect(await fake.version(platform)).toBe(TARGET);
      // The drain aimed at blue is written by the colour that just came up,
      // through the one process that is its API.
      expect(drainedThrough()[0]).toBe(platform);
      // The spawner leaves free what the new colour reserves: the database
      // and one process, not three.
      expect(environmentOf(`${PROJECT}-sandbox`).SANDBOX_RESERVED_MEMORY).toBe(
        '768m',
      );

      // Drained, then cut out of the serving names, then stopped: every
      // service of the retiring colour that held one of them.
      const where = (match: (args: readonly string[]) => boolean) =>
        calls.flatMap((call, index) => (match(call.args) ? [index] : []));
      const drains = where((args) =>
        args.some((word) => /\/api\/control\/drain(-status)?\b/.test(word)),
      );
      const disconnects = where(
        (args) => args[0] === 'network' && args[1] === 'disconnect',
      );
      const stops = where((args) => args[0] === 'stop');
      expect(
        disconnects.map((index) => calls[index]?.args.at(-1)).toSorted(),
      ).toEqual([
        `${PROJECT}-blue-backend-api-1`,
        `${PROJECT}-blue-backend-api-1`,
        `${PROJECT}-blue-platform-1`,
        `${PROJECT}-blue-platform-1`,
      ]);
      expect(Math.max(...drains)).toBeLessThan(Math.min(...disconnects));
      expect(Math.max(...disconnects)).toBeLessThan(Math.min(...stops));
    });

    test('two colours of one process flip like any two, the drain through platform on both sides', async () => {
      seedStateful(fake);
      fake.seedImage(platformImage(TARGET), APP_IN_BACKEND);
      fake.seedImage(platformImage(NEXT), APP_IN_BACKEND);
      seedColour(fake, 'green', TARGET, 'unified');
      await workspace('green');

      await run(NEXT);

      expect(await getCurrentColor(deployDir)).toBe('blue');
      expect(await servicesOf('blue')).toEqual(['platform']);
      expect(await servicesOf('green')).toEqual([]);
      expect(await fake.version(`${PROJECT}-blue-platform-1`)).toBe(NEXT);
      expect(drainedThrough()[0]).toBe(`${PROJECT}-blue-platform-1`);
      // The retiring colour's one process counts as its API, so the drain
      // waits out what it has in flight instead of finding no api to wait
      // for.
      expect(
        calls.some(({ args }) =>
          args.some((word) => word.includes('/api/control/drain-status')),
        ),
      ).toBe(true);
      // Its one container held both serving names, on both networks.
      expect(
        calls
          .filter(({ args }) => args[0] === 'network')
          .filter(({ args }) => args[1] === 'disconnect')
          .map(({ args }) => args.slice(2).join(' '))
          .toSorted(),
      ).toEqual([
        `${PROJECT}_internal ${PROJECT}-green-platform-1`,
        `tale-sandbox-net ${PROJECT}-green-platform-1`,
      ]);
    });

    test('a backend replica count brings the job runners up apart', async () => {
      seedLiveBlue(fake);
      fake.seedImage(platformImage(TARGET), APP_IN_BACKEND);
      await workspace('blue');
      process.env.TALE_BACKEND_WORKER_REPLICAS = '2';

      await run(TARGET);

      expect(await servicesOf('green')).toEqual([
        'backend-worker',
        'backend-worker',
        'platform',
      ]);
      expect(upsOf('green')).toEqual([
        '--scale platform=1 --scale backend-worker=2 platform backend-worker',
      ]);
      expect(environmentOf(`${PROJECT}-green-platform-1`).TALE_ROLE).toBe(
        'api',
      );
      expect(environmentOf(`${PROJECT}-green-backend-worker-2`).TALE_ROLE).toBe(
        'worker',
      );
      // The database, one process that is the API and two job runners.
      expect(environmentOf(`${PROJECT}-sandbox`).SANDBOX_RESERVED_MEMORY).toBe(
        '1280m',
      );
    });

    test('a workspace that asks for three services gets them from an image that could be one process', async () => {
      // What a workspace does before it goes back to a CLI from before the
      // shapes, whose writer census looks for the two backend services.
      seedStateful(fake);
      fake.seedImage(platformImage(LIVE), APP_IN_BACKEND);
      fake.seedImage(platformImage(TARGET), APP_IN_BACKEND);
      seedColour(fake, 'blue', LIVE, 'unified');
      await workspace('blue');
      process.env.TALE_APP_TIER = 'three-services';

      await run(TARGET);

      expect(await getCurrentColor(deployDir)).toBe('green');
      expect(await servicesOf('green')).toEqual([
        'backend-api',
        'backend-worker',
        'platform',
      ]);
      expect(
        environmentOf(`${PROJECT}-green-platform-1`).TALE_ROLE,
      ).toBeUndefined();
      expect(environmentOf(`${PROJECT}-green-backend-api-1`).TALE_ROLE).toBe(
        'api',
      );
      expect(await servicesOf('blue')).toEqual([]);
    });

    test('a shape named by a word that is none is refused before anything is pulled', async () => {
      seedLiveBlue(fake);
      fake.seedImage(platformImage(TARGET), APP_IN_BACKEND);
      await workspace('blue');
      process.env.TALE_APP_TIER = 'three';

      await expect(run(TARGET)).rejects.toThrow(
        'TALE_APP_TIER must be one-process, workers-apart, three-services, or unset; got: "three"',
      );

      expect(calls.some(({ args }) => args[0] === 'pull')).toBe(false);
      expect(calls.some(({ args }) => args[0] === 'compose')).toBe(false);
      expect(await getCurrentColor(deployDir)).toBe('blue');
    });

    test('a database profile the image does not know is refused before anything is pulled', async () => {
      seedLiveBlue(fake);
      fake.seedImage(platformImage(TARGET), APP_IN_BACKEND);
      await workspace('blue');
      process.env.DB_PROFILE = 'tiny';

      await expect(run(TARGET)).rejects.toThrow(
        'DB_PROFILE must be small, standard, or unset; got: "tiny"',
      );

      expect(calls.some(({ args }) => args[0] === 'pull')).toBe(false);
      expect(calls.some(({ args }) => args[0] === 'compose')).toBe(false);
      expect(await getCurrentColor(deployDir)).toBe('blue');
    });

    describe('the PO-token provider', () => {
      const SIDECAR = `${PROJECT}-bgutil-provider`;
      /** The docker calls that name the sidecar, as `verb …rest`. */
      const sidecarCalls = (): string[] =>
        calls
          .map(({ args }) => args.join(' '))
          .filter((line) => line.includes('bgutil-provider'));

      test('is started where the deployment asked for it', async () => {
        seedLiveBlue(fake);
        fake.seedImage(platformImage(TARGET), APP_IN_BACKEND);
        await workspace('blue');
        process.env.VIDEO_INGEST_POT_PROVIDER = 'true';

        await run(TARGET);

        expect(
          sidecarCalls().filter((line) => line.startsWith('compose ')),
        ).toEqual([
          expect.stringMatching(
            /^compose -p \S+ -f \S+ up -d bgutil-provider$/,
          ),
        ]);
        expect(sidecarCalls().some((line) => line.startsWith('rm '))).toBe(
          false,
        );
        expect(fake.instances.has(SIDECAR)).toBe(true);
      });

      // Every deployment had one before the provider was something to ask
      // for; nothing in the stateful document names it any more, so nothing
      // else would ever stop it.
      test('is removed where an earlier deploy left one and the deployment did not ask', async () => {
        seedLiveBlue(fake);
        fake.seedImage(platformImage(TARGET), APP_IN_BACKEND);
        await workspace('blue');
        expect(fake.instances.has(SIDECAR)).toBe(true);

        await run(TARGET);

        expect(fake.instances.has(SIDECAR)).toBe(false);
        expect(
          sidecarCalls().some((line) => line.includes('up -d bgutil-provider')),
        ).toBe(false);
        expect(await getCurrentColor(deployDir)).toBe('green');
      });

      test('is neither started nor looked for twice where there is none', async () => {
        seedLiveBlue(fake);
        fake.instances.delete(SIDECAR);
        fake.seedImage(platformImage(TARGET), APP_IN_BACKEND);
        await workspace('blue');
        process.env.VIDEO_INGEST_POT_PROVIDER = 'false';

        await run(TARGET);

        expect(fake.instances.has(SIDECAR)).toBe(false);
        expect(
          sidecarCalls().filter(
            (line) => line.startsWith('compose ') || line.startsWith('rm '),
          ),
        ).toEqual([]);
        expect(await getCurrentColor(deployDir)).toBe('green');
      });

      test('a word that is neither true nor false is refused before anything is pulled', async () => {
        seedLiveBlue(fake);
        fake.seedImage(platformImage(TARGET), APP_IN_BACKEND);
        await workspace('blue');
        process.env.VIDEO_INGEST_POT_PROVIDER = 'yes';

        await expect(run(TARGET)).rejects.toThrow(
          'VIDEO_INGEST_POT_PROVIDER must be true, false, or unset; got: "yes"',
        );

        expect(calls.some(({ args }) => args[0] === 'pull')).toBe(false);
        expect(calls.some(({ args }) => args[0] === 'compose')).toBe(false);
        expect(fake.instances.has(SIDECAR)).toBe(true);
      });
    });

    // The model relay in the backend replaced the sandbox LLM gateway
    // (tale-project/tale#4942). A deployment of an earlier release still
    // runs one, through which keys it minted settle: where the always-roll
    // tier converges, a deploy asks the live backend how many are open
    // (retire-gateway.ts, whose own suite holds each answer's words).
    describe('the model gateway an earlier release left', () => {
      const GATEWAY = `${PROJECT}-sandbox-llm-gateway`;
      const STORE = `${PROJECT}_llm-gateway-data`;
      const lines = (): string[] => calls.map(({ args }) => args.join(' '));
      /** The live backend answers the gateway's keys with `answer`. */
      const keysAnswer = (answer: {
        success: boolean;
        stdout: string;
        stderr: string;
        exitCode: number;
      }): void => {
        fake.execHandler = (_instance, argv) =>
          argv.join(' ').includes('/api/control/gateway-keys')
            ? answer
            : undefined;
      };

      test('is retired once no key it minted is open, after the always-roll tier converged, and its volume stays', async () => {
        seedLiveBlue(fake);
        fake.seedImage(platformImage(TARGET), APP_IN_BACKEND);
        await workspace('blue');

        await run(TARGET);

        expect(fake.instances.has(GATEWAY)).toBe(false);
        expect(fake.volumes.has(STORE)).toBe(true);
        expect(lines()).toContain(`rm -f ${GATEWAY}`);
        expect(lines().some((line) => line.startsWith('volume rm'))).toBe(
          false,
        );
        // No document the deploy brings up names the gateway or its store,
        // and nothing pulls its image.
        expect(
          lines().some(
            (line) =>
              (line.startsWith('compose ') || line.startsWith('pull ')) &&
              line.includes('llm-gateway'),
          ),
        ).toBe(false);
        const question = lines().findIndex((line) =>
          line.includes('/api/control/gateway-keys'),
        );
        const tier = lines().findIndex(
          (line) =>
            line.startsWith(`compose -p ${PROJECT} `) &&
            line.includes(' up -d sandbox sandbox-egress'),
        );
        const colour = lines().findIndex((line) =>
          line.startsWith(`compose -p ${PROJECT}-green `),
        );
        expect(tier).toBeGreaterThan(-1);
        expect(question).toBeGreaterThan(tier);
        expect(question).toBeLessThan(colour);
        expect(await getCurrentColor(deployDir)).toBe('green');
      });

      test('stays as it is while turns settle through it', async () => {
        seedLiveBlue(fake);
        fake.seedImage(platformImage(TARGET), APP_IN_BACKEND);
        await workspace('blue');
        keysAnswer({
          success: true,
          stdout: '{"open":2}',
          stderr: '',
          exitCode: 0,
        });
        const before = fake.instances.get(GATEWAY)?.id;

        await run(TARGET);

        expect(fake.instances.get(GATEWAY)?.id).toBe(before);
        expect(fake.instances.get(GATEWAY)?.state).toBe('running');
        expect(
          lines().some(
            (line) =>
              line.includes(GATEWAY) &&
              /^(rm|stop|start|restart|update) /.test(line),
          ),
        ).toBe(false);
        expect(await getCurrentColor(deployDir)).toBe('green');
      });

      // The first deploy of this release asks the live colour, which still
      // runs the earlier release, whose backend has no such door.
      test('stays as it is where the live backend has no answer, and the deploy goes on', async () => {
        seedLiveBlue(fake);
        fake.seedImage(platformImage(TARGET), APP_IN_BACKEND);
        await workspace('blue');
        keysAnswer({
          success: false,
          stdout: '',
          stderr: 'curl: (22) The requested URL returned error: 404',
          exitCode: 22,
        });

        await run(TARGET);

        expect(fake.instances.get(GATEWAY)?.state).toBe('running');
        expect(lines()).not.toContain(`rm -f ${GATEWAY}`);
        expect(await getCurrentColor(deployDir)).toBe('green');
      });

      test('a dry run asks, and retires nothing', async () => {
        seedLiveBlue(fake);
        fake.seedImage(platformImage(TARGET), APP_IN_BACKEND);
        await workspace('blue');
        const { deploy } = await import('../../actions/deploy');

        await deploy({
          version: TARGET,
          stop: false,
          env: {
            GHCR_REGISTRY: REGISTRY,
            SITE_URL: 'https://localhost',
            HEALTH_CHECK_TIMEOUT: 1,
            DRAIN_TIMEOUT: 0,
            DEPLOY_DIR: deployDir,
          },
          hostAlias: 'localhost',
          dryRun: true,
          quiet: true,
        });

        expect(
          lines().some((line) => line.includes('/api/control/gateway-keys')),
        ).toBe(true);
        expect(fake.instances.has(GATEWAY)).toBe(true);
        expect(lines().some((line) => line.startsWith('rm '))).toBe(false);
        expect(await getCurrentColor(deployDir)).toBe('blue');
      });

      test('--services on the application tier leaves it to the deploy that rolls the always-roll tier', async () => {
        seedLiveBlue(fake);
        fake.seedImage(platformImage(TARGET), APP_IN_BACKEND);
        await workspace('blue');

        await run(TARGET, { services: ['platform'] });

        expect(fake.instances.has(GATEWAY)).toBe(true);
        expect(
          lines().some((line) => line.includes('/api/control/gateway-keys')),
        ).toBe(false);
      });
    });

    test('one process asked for by name ignores a backend count, which it scales nothing with', async () => {
      seedLiveBlue(fake);
      fake.seedImage(platformImage(TARGET), APP_IN_BACKEND);
      await workspace('blue');
      process.env.TALE_APP_TIER = 'one-process';
      process.env.TALE_BACKEND_WORKER_REPLICAS = '3';
      process.env.TALE_PLATFORM_REPLICAS = '2';

      await run(TARGET);

      expect(await servicesOf('green')).toEqual(['platform', 'platform']);
      expect(upsOf('green')).toEqual(['--scale platform=2 platform']);
      expect(environmentOf(`${PROJECT}-green-platform-2`).TALE_ROLE).toBe(
        'all',
      );
    });

    test('an image from before the app moved still comes up as three services over a colour of one process', async () => {
      seedStateful(fake);
      fake.seedImage(platformImage(LIVE), APP_IN_BACKEND);
      seedColour(fake, 'blue', LIVE, 'unified');
      await workspace('blue');

      await run(TARGET);

      expect(await getCurrentColor(deployDir)).toBe('green');
      expect(await servicesOf('green')).toEqual([
        'backend-api',
        'backend-worker',
        'platform',
      ]);
      expect(
        environmentOf(`${PROJECT}-green-platform-1`).TALE_ROLE,
      ).toBeUndefined();
      expect(await servicesOf('blue')).toEqual([]);
      expect(drainedThrough()[0]).toBe(`${PROJECT}-green-backend-api-1`);
      expect(environmentOf(`${PROJECT}-sandbox`).SANDBOX_RESERVED_MEMORY).toBe(
        '1152m',
      );
    });

    test('--services replaces containers of the live colour as it is', async () => {
      // A colour of three services keeps its web tier a web tier, although
      // the image could be the whole application.
      seedLiveBlue(fake);
      fake.seedImage(platformImage(TARGET), APP_IN_BACKEND);
      await workspace('blue');

      await run(TARGET, { services: ['platform'] });

      expect(await getCurrentColor(deployDir)).toBe('blue');
      expect(await servicesOf('blue')).toEqual([
        'backend-api',
        'backend-worker',
        'platform',
      ]);
      expect(upsOf('blue')).toEqual(['--scale platform=1 platform']);
      const platform = `${PROJECT}-blue-platform-1`;
      expect(await fake.version(platform)).toBe(TARGET);
      expect(environmentOf(platform).TALE_ROLE).toBeUndefined();
      expect(await fake.version(`${PROJECT}-blue-backend-api-1`)).toBe(LIVE);
      // Its API was not replaced, so nothing was drained.
      expect(drainedThrough()).toEqual([]);
    });

    test('--services platform on a colour of one process replaces the API, so it drains first', async () => {
      seedStateful(fake);
      fake.seedImage(platformImage(LIVE), APP_IN_BACKEND);
      fake.seedImage(platformImage(TARGET), APP_IN_BACKEND);
      seedColour(fake, 'blue', LIVE, 'unified');
      await workspace('blue');

      await run(TARGET, { services: ['platform'] });

      expect(await servicesOf('blue')).toEqual(['platform']);
      const platform = `${PROJECT}-blue-platform-1`;
      expect(await fake.version(platform)).toBe(TARGET);
      expect(environmentOf(platform).TALE_ROLE).toBe('all');
      const drain = calls.findIndex(({ args }) =>
        args.some((word) => /\/api\/control\/drain(?!-status)\b/.test(word)),
      );
      const up = calls.findIndex(
        ({ args }) => args[0] === 'compose' && args.includes('up'),
      );
      expect(drain).toBeGreaterThan(-1);
      expect(drain).toBeLessThan(up);
    });

    test('--services refuses a service the live colour does not run, before anything changes', async () => {
      seedStateful(fake);
      fake.seedImage(platformImage(LIVE), APP_IN_BACKEND);
      fake.seedImage(platformImage(TARGET), APP_IN_BACKEND);
      seedColour(fake, 'blue', LIVE, 'unified');
      await workspace('blue');

      await expect(run(TARGET, { services: ['backend-api'] })).rejects.toThrow(
        'The blue colour runs platform: it has no backend-api to update.',
      );

      expect(calls.some(({ args }) => args[0] === 'compose')).toBe(false);
      expect(calls.some(({ args }) => args[0] === 'tag')).toBe(false);
      expect(await fake.version(`${PROJECT}-blue-platform-1`)).toBe(LIVE);
    });

    test('--services refuses an image from before the app moved for a colour of one process', async () => {
      seedStateful(fake);
      fake.seedImage(platformImage(LIVE), APP_IN_BACKEND);
      seedColour(fake, 'blue', LIVE, 'unified');
      await workspace('blue');

      await expect(run(TARGET, { services: ['platform'] })).rejects.toThrow(
        /The live blue colour runs the application as platform, which .*tale-platform:0\.6\.1 cannot.*without --services/,
      );

      expect(calls.some(({ args }) => args[0] === 'compose')).toBe(false);
      expect(await fake.version(`${PROJECT}-blue-platform-1`)).toBe(LIVE);
    });

    test('a deploy of the stateful tier alone tells the spawner what the live colour reserves', async () => {
      seedStateful(fake);
      fake.seedImage(platformImage(LIVE), APP_IN_BACKEND);
      seedColour(fake, 'blue', LIVE, 'unified');
      await workspace('blue');

      await run(TARGET, { services: ['sandbox'] });

      expect(environmentOf(`${PROJECT}-sandbox`).SANDBOX_RESERVED_MEMORY).toBe(
        '768m',
      );
      expect(await fake.version(`${PROJECT}-blue-platform-1`)).toBe(LIVE);
    });

    test('a flip resumes onto a colour that is up in the shape asked, without starting it again', async () => {
      seedLiveBlue(fake);
      fake.seedImage(platformImage(TARGET), APP_IN_BACKEND);
      seedColour(fake, 'green', TARGET, 'unified');
      await workspace('blue');
      await setFlipPending(deployDir, { promoting: 'green', retiring: 'blue' });

      await run(TARGET);

      expect(upsOf('green')).toEqual([]);
      expect(await getCurrentColor(deployDir)).toBe('green');
      expect(await servicesOf('green')).toEqual(['platform']);
      expect(await servicesOf('blue')).toEqual([]);
      expect(await getFlipPending(deployDir)).toBeNull();
    });

    test('a colour an earlier deploy left up in another shape is started again, never resumed onto', async () => {
      // Started with the job runners apart, then the deployment stopped
      // asking for that: its platform runs no jobs, and its worker may be
      // gone by the next deploy.
      seedLiveBlue(fake);
      fake.seedImage(platformImage(TARGET), APP_IN_BACKEND);
      seedColour(fake, 'green', TARGET, 'split');
      await workspace('blue');
      await setFlipPending(deployDir, { promoting: 'green', retiring: 'blue' });

      await run(TARGET);

      expect(upsOf('green')).toEqual(['--scale platform=1 platform']);
      expect(await getCurrentColor(deployDir)).toBe('green');
      expect(await servicesOf('green')).toEqual(['platform']);
      expect(environmentOf(`${PROJECT}-green-platform-1`).TALE_ROLE).toBe(
        'all',
      );
    });

    test('a platform that runs no jobs does not pass for the whole application once its worker is gone', async () => {
      seedLiveBlue(fake);
      fake.seedImage(platformImage(TARGET), APP_IN_BACKEND);
      seedColour(fake, 'green', TARGET, 'split');
      fake.instances.delete(`${PROJECT}-green-backend-worker-1`);
      await workspace('blue');
      await setFlipPending(deployDir, { promoting: 'green', retiring: 'blue' });

      await run(TARGET);

      expect(upsOf('green')).toEqual(['--scale platform=1 platform']);
      expect(environmentOf(`${PROJECT}-green-platform-1`).TALE_ROLE).toBe(
        'all',
      );
    });

    /** What a run changed: every stop, removal and `compose up` it asked. */
    const changes = (): string[] =>
      calls.flatMap(({ args }) =>
        args[0] === 'stop' ||
        args[0] === 'rm' ||
        (args[0] === 'compose' && args.includes('up'))
          ? [
              args[0] === 'compose'
                ? `up ${args[args.indexOf('-p') + 1]}`
                : `${args[0]} ${args.at(-1)}`,
            ]
          : [],
      );
    /** The flip to green was recorded and blue not retired yet. */
    const interruptedAfterTheSwitch = async (): Promise<void> => {
      seedLiveBlue(fake);
      fake.seedImage(platformImage(TARGET), APP_IN_BACKEND);
      seedColour(fake, 'green', TARGET, 'unified');
      await workspace('green');
      await setFlipPending(deployDir, { promoting: 'green', retiring: 'blue' });
    };

    test('a flip interrupted after the switch finishes around the colour that serves, in the shape it has', async () => {
      await interruptedAfterTheSwitch();
      // Asked for now, and not what green runs.
      process.env.TALE_APP_TIER = 'three-services';

      await run(TARGET);

      // Green held the traffic throughout: never stopped, removed or started.
      expect(changes().filter((change) => change.includes('green'))).toEqual(
        [],
      );
      expect(await servicesOf('green')).toEqual(['platform']);
      expect(environmentOf(`${PROJECT}-green-platform-1`).TALE_ROLE).toBe(
        'all',
      );
      // The flip it interrupted is finished: blue is retired, the record gone.
      expect(await servicesOf('blue')).toEqual([]);
      expect(await getCurrentColor(deployDir)).toBe('green');
      expect(await getFlipPending(deployDir)).toBeNull();

      // The shape asked for comes with the next deploy, as a flip of its own.
      calls = [];
      await run(TARGET);
      expect(await getCurrentColor(deployDir)).toBe('blue');
      expect(await servicesOf('blue')).toEqual([
        'backend-api',
        'backend-worker',
        'platform',
      ]);
      expect(await servicesOf('green')).toEqual([]);
    });

    test('nor is it started again for a replica count raised since', async () => {
      await interruptedAfterTheSwitch();
      process.env.TALE_PLATFORM_REPLICAS = '2';

      await run(TARGET);

      expect(changes().filter((change) => change.includes('green'))).toEqual(
        [],
      );
      expect(await servicesOf('green')).toEqual(['platform']);
      expect(await servicesOf('blue')).toEqual([]);
      expect(await getFlipPending(deployDir)).toBeNull();
    });

    test('a colour that holds the traffic on record and serves none of it is started again', async () => {
      await interruptedAfterTheSwitch();
      const platform = fake.instances.get(`${PROJECT}-green-platform-1`);
      if (platform === undefined) throw new Error('seed');
      platform.state = 'exited';

      await run(TARGET);

      expect(upsOf('green')).toEqual(['--scale platform=1 platform']);
      expect(await getCurrentColor(deployDir)).toBe('green');
      expect(await servicesOf('blue')).toEqual([]);
    });

    test('on a protocol-2 host, a colour that serves is held to the admitted image whatever shape is asked', async () => {
      // A released image is known under its repository digest, and its
      // database is past the writer protocol cutover.
      const digestOf = (version: string): string =>
        `${REGISTRY}/tale-platform@sha256:${createHash('sha256')
          .update(`digest:${platformImage(version)}`)
          .digest('hex')}`;
      const release = (
        version: string,
        labels: Record<string, string> = {},
      ): void => {
        const image = fake.seedImage(platformImage(version), {
          'io.tale.automation-writer-protocol': '2',
          'org.opencontainers.image.revision': createHash('sha1')
            .update(version)
            .digest('hex'),
          'org.opencontainers.image.source':
            'https://github.com/tale-project/tale',
          ...labels,
        });
        fake.images.set(digestOf(version), image);
      };
      release(LIVE);
      release(TARGET, APP_IN_BACKEND);
      release(NEXT, APP_IN_BACKEND);
      fake.execHandler = (_instance, _argv, stdin) =>
        stdin?.includes('app_migrations')
          ? {
              success: true,
              exitCode: 0,
              stdout:
                '{"schema":"public","ids":["0001_initial.sql","0163_automation_legacy_protocol.sql"]}',
              stderr: '',
            }
          : undefined;
      seedStateful(fake);
      seedColour(fake, 'blue', LIVE, 'three-way');
      seedColour(fake, 'green', TARGET, 'unified');
      await workspace('green');
      await setFlipPending(deployDir, { promoting: 'green', retiring: 'blue' });

      // Another release and another shape: green would have to be replaced
      // to give either, and it holds the traffic.
      process.env.TALE_APP_TIER = 'three-services';
      await expect(run(NEXT)).rejects.toThrow(
        'Pending automation writer differs from the admitted image',
      );

      expect(changes()).toEqual([]);
      expect(await fake.version(`${PROJECT}-green-platform-1`)).toBe(TARGET);
      expect(await getCurrentColor(deployDir)).toBe('green');
      expect(await getFlipPending(deployDir)).toEqual({
        promoting: 'green',
        retiring: 'blue',
      });
    });

    test('--services refuses a live colour whose platform will not say what it runs', async () => {
      seedLiveBlue(fake);
      fake.seedImage(platformImage(TARGET), APP_IN_BACKEND);
      await workspace('blue');
      refuses = (args) =>
        args[0] === 'container' &&
        args[1] === 'inspect' &&
        args.length === 3 &&
        args[2] === `${PROJECT}-blue-platform-1`;

      await expect(run(TARGET, { services: ['platform'] })).rejects.toThrow(
        `Could not read which services the blue colour runs: ${PROJECT}-blue-platform-1 did not answer an inspect. Nothing was changed.`,
      );

      // Never the image's shape instead: that would start the whole
      // application in the web tier's container, beside the api and worker.
      expect(changes()).toEqual([]);
      expect(await fake.version(`${PROJECT}-blue-platform-1`)).toBe(LIVE);
    });

    test('--services still updates a colour of three services that lost its web tier', async () => {
      seedLiveBlue(fake);
      fake.seedImage(platformImage(TARGET), APP_IN_BACKEND);
      fake.instances.delete(`${PROJECT}-blue-platform-1`);
      await workspace('blue');

      await run(TARGET, { services: ['backend-worker'] });

      expect(upsOf('blue')).toEqual([
        '--scale backend-worker=1 backend-worker',
      ]);
      expect(await fake.version(`${PROJECT}-blue-backend-worker-1`)).toBe(
        TARGET,
      );
    });

    test('--services without a deployment says there is none, whatever it names', async () => {
      // An empty host: nothing recorded, nothing running.
      fake.seedImage(platformImage(TARGET), APP_IN_BACKEND);
      writeFileSync(
        join(deployDir, 'tale.json'),
        JSON.stringify({
          version: 1,
          cliVersion: TARGET,
          createdAt: '2026-11-12T00:00:00.000Z',
          id: PROJECT,
        }),
      );

      await expect(run(TARGET, { services: ['backend-api'] })).rejects.toThrow(
        'No active deployment for in-place update',
      );
    });

    test('a control call reaches the stateful backend of a host whose colour is the web tier alone', async () => {
      // A host from before the backend joined the colours: the colour is a
      // platform with no backend-api beside it, and the API is the singleton.
      const { backendApiContainer } = await import('../../docker/control-call');
      seedStateful(fake);
      fake.seedInstance({
        stack: `${PROJECT}-blue`,
        service: 'platform',
        image: platformImage(LIVE),
        networks: [`${PROJECT}_internal`],
      });
      fake.seedInstance({
        name: `${PROJECT}-backend-api`,
        stack: PROJECT,
        service: 'backend-api',
        image: platformImage(LIVE),
        networks: [`${PROJECT}_internal`],
      });

      expect(await backendApiContainer(null, createDockerRuntime())).toBe(
        `${PROJECT}-backend-api`,
      );
    });
  });

  // Which server the blob store runs is what the deployment's volumes hold
  // (docker/resolve-object-store.ts, tale-project/tale#4942).
  describe('a deploy runs the blob store its blobs are in', () => {
    const STORE = `${PROJECT}-object-store`;
    const deployWith = async (
      options: { stop?: boolean; services?: ServiceName[] } = {},
    ): Promise<void> => {
      writeFileSync(
        join(deployDir, 'tale.json'),
        JSON.stringify({
          version: 1,
          cliVersion: TARGET,
          createdAt: '2026-11-12T00:00:00.000Z',
          id: PROJECT,
        }),
      );
      await setCurrentColor(deployDir, 'blue');
      const { deploy } = await import('../../actions/deploy');
      await deploy({
        version: TARGET,
        stop: options.stop ?? false,
        env: {
          GHCR_REGISTRY: REGISTRY,
          SITE_URL: 'https://localhost',
          HEALTH_CHECK_TIMEOUT: 1,
          DRAIN_TIMEOUT: 0,
          DEPLOY_DIR: deployDir,
        },
        hostAlias: 'localhost',
        dryRun: false,
        quiet: true,
        skipBackup: true,
        ...(options.services === undefined
          ? {}
          : { services: options.services }),
      });
    };
    const store = () => fake.instances.get(STORE);

    // A deploy that replaces the store (`--services object-store` here,
    // `--stop` on a running store) moves the blobs; the move switches the
    // stack's store itself, through what the deploy hands it.
    test("a deploy that replaces the store moves the blobs in MinIO's volume, and runs versitygw after", async () => {
      seedLiveBlue(fake);
      process.env.OBJECT_STORE_SECRET_KEY = 'se/cr:et@x';
      move = async (options) => {
        expect(await options.convergeStore('versitygw')).toBe(true);
        return { moved: true, objects: 3, bytes: 300 };
      };

      try {
        await deployWith({ services: ['object-store'] });
      } finally {
        delete process.env.OBJECT_STORE_SECRET_KEY;
      }

      expect(moves).toHaveLength(1);
      expect(moves[0]).toMatchObject({
        prefix: `${PROJECT}_`,
        project: PROJECT,
        accessKey: 'tale',
        secretKey: 'se/cr:et@x',
      });
      expect(store()?.image).toBe(THIRD_PARTY_IMAGES['object-store']);
      // The image the move starts was pulled before it.
      expect(
        calls.some(
          ({ args }) =>
            args[0] === 'pull' &&
            args.includes(THIRD_PARTY_IMAGES['object-store']),
        ),
      ).toBe(true);
    });

    test('a move that does not happen leaves the store MinIO, on its volume', async () => {
      seedLiveBlue(fake);
      move = async () => ({ moved: false, reason: 'no room' });

      await deployWith({ services: ['object-store'] });

      expect(moves).toHaveLength(1);
      // MinIO, on MinIO's volume: the shape of each server is
      // compose-parity.test.ts's to hold.
      expect(store()?.image).toBe(MINIO_IMAGE);
      // Nothing was written into versitygw's volume.
      expect(fake.volumes.get(`${PROJECT}_blob-data`)?.size ?? 0).toBe(0);
    });

    test('a deploy that leaves the running store alone moves nothing and keeps MinIO', async () => {
      seedLiveBlue(fake);
      const before = store()?.image;

      await deployWith({ services: ['sandbox'] });

      expect(moves).toEqual([]);
      expect(store()?.image).toBe(before);
    });

    test('a deployment whose blobs are in versitygw’s volume runs versitygw', async () => {
      seedLiveBlue(fake);
      fake.seedVolume(`${PROJECT}_blob-data`, { 'tale-blobs/org/a': 'blob' });

      await deployWith({ services: ['object-store'] });

      expect(store()?.image).toBe(THIRD_PARTY_IMAGES['object-store']);
    });

    test('a deployment that never stored a blob gets versitygw', async () => {
      seedLiveBlue(fake);
      // MinIO's volume exists and is empty: the store never ran there.
      fake.seedVolume(`${PROJECT}_object-store-data`);

      await deployWith({ services: ['object-store'] });

      expect(store()?.image).toBe(THIRD_PARTY_IMAGES['object-store']);
    });

    test('a deploy that cannot look into the blob volumes stops before it pulls or changes anything', async () => {
      seedLiveBlue(fake);
      refuses = (args) =>
        args[0] === 'run' && String(args.at(-1)).includes('-print -quit');
      const before = store()?.image;

      await expect(deployWith({ services: ['object-store'] })).rejects.toThrow(
        /Could not inspect demo-abc123_blob-data for existing blobs/,
      );

      expect(calls.some(({ args }) => args[0] === 'pull')).toBe(false);
      expect(store()?.image).toBe(before);
    });
  });

  describe('each verb asks Docker what the actions asked', () => {
    const api = `${PROJECT}-blue-backend-api-1`;

    test('exec, copies, one-shot jobs, tags, networks and volumes', async () => {
      seedLiveBlue(fake);
      const runtime = createDockerRuntime();
      const stage = join(deployDir, 'stage');
      mkdirSync(stage);
      writeFileSync(join(stage, 'org.json'), '{}');
      const out = join(deployDir, 'out');
      mkdirSync(out);

      await runtime.exec(api, ['sh', '-c', 'true']);
      await runtime.exec(api, ['sh', '-c', 'cat'], { stdin: 'payload' });
      await runtime.copyIn(api, stage, '/app/data/', {
        user: 'app',
        group: 'app',
      });
      await runtime.copyOut(api, '/app/data', out, {
        maxBytes: 1_000,
        timeoutS: 30,
      });
      await runtime.oneShot({
        image: 'alpine:3.22',
        mounts: [{ volume: `${PROJECT}_backups`, target: '/backup' }],
        argv: ['sh', '-c', 'cat > /backup/x'],
        stdin: 'manifest',
        timeoutS: 30,
      });
      await runtime.tag('example/tool:1', 'tool:latest');
      fake.unpullable.add('example/broken:1');
      const ensured = await runtime.ensureImages([
        { reference: 'example/tool:2', alias: 'tool:latest' },
        { reference: 'example/broken:1', alias: 'broken:latest' },
        { reference: 'example/plain:3' },
      ]);
      await runtime.pruneNetworks();
      await runtime.volumeRemovalHint(`${PROJECT}_backups`);

      expect(describeCalls(calls, fake, deployDir)).toEqual([
        `docker exec ${api} sh -c true`,
        `docker exec -i ${api} sh -c cat | stdin=${sha('payload')}`,
        `docker cp <deploy-dir>/stage/. ${api}:/app/data/`,
        `docker exec ${api} chown -R app:app /app/data/`,
        `docker cp ${api}:/app/data/. <deploy-dir>/out/ | silent timeout=30`,
        `docker run --rm -i -v ${PROJECT}_backups:/backup alpine:3.22 sh -c cat > /backup/x | timeout=30 stdin=${sha('manifest')}`,
        'docker tag example/tool:1 tool:latest',
        // ensureImages: every pull first, then the tags, as a deploy does.
        'docker pull example/tool:2',
        'docker pull example/broken:1',
        'docker pull example/plain:3',
        'docker tag example/tool:2 tool:latest',
        `docker network prune -f --filter label=project=${PROJECT}`,
        `docker volume inspect ${PROJECT}_backups`,
      ]);
      expect(ensured).toEqual({
        failed: [{ reference: 'example/broken:1', detail: 'pull failed' }],
      });
    });

    test('inspectImage reads the registry, never Docker', async () => {
      const asked: string[] = [];
      const runtime = createDockerRuntime({
        platform: 'linux/arm64',
        registry: {
          resolve: async (reference, platform) => {
            asked.push(`${reference} ${platform}`);
            return {
              reference: `${reference}@sha256:${'e'.repeat(64)}`,
              digest: `sha256:${'e'.repeat(64)}`,
              manifestDigest: `sha256:${'f'.repeat(64)}`,
              configDigest: `sha256:${'1'.repeat(64)}`,
              os: 'linux',
              architecture: 'arm64',
              variant: 'v8',
              config: {
                config: {
                  Labels: { 'dev.tale.init': 'dumb-init' },
                  User: 'app',
                },
              },
            };
          },
        },
      });
      const facts = await runtime.inspectImage('example/tool:2');
      expect(asked).toEqual(['example/tool:2 linux/arm64']);
      expect(facts).toMatchObject({ init: 'dumb-init', user: 'app' });
      expect(calls).toEqual([]);
    });

    testPosix(
      'the interrupt cleanup stops what compose created, with the filters deploy used',
      () => {
        const log = process.env.TALE_FAKE_DOCKER_LOG ?? '';
        rmSync(log, { force: true });
        createDockerRuntime().onInterrupt([`${PROJECT}-green`]);
        expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual([
          `ps -aq --filter label=com.docker.compose.project=${PROJECT}-green --filter label=com.docker.compose.container-number`,
          'stop -t 2 c0ffee000001',
          'rm -f c0ffee000001',
          'stop -t 2 c0ffee000002',
          'rm -f c0ffee000002',
        ]);
      },
    );

    testPosix(
      'logs read both streams line by line, or pass them through, with the exit code',
      async () => {
        const log = process.env.TALE_FAKE_DOCKER_LOG ?? '';
        rmSync(log, { force: true });
        const runtime = createDockerRuntime();
        const lines: string[] = [];
        expect(
          await runtime.logs(
            api,
            { follow: true, since: '10m', tail: 5 },
            (line) => lines.push(line),
          ),
        ).toBe(3);
        expect(lines.sort()).toEqual(['first line', 'second line']);
        expect(await runtime.logs(api, { follow: false })).toBe(3);
        expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual([
          `logs --follow --since 10m --tail 5 ${api}`,
          `logs ${api}`,
        ]);
      },
    );

    testPosix(
      'streams a backups file out and in through a helper cat, the path as an argument',
      async () => {
        const log = process.env.TALE_FAKE_DOCKER_LOG ?? '';
        rmSync(log, { force: true });
        const runtime = createDockerRuntime();
        const read: Uint8Array[] = [];
        await runtime.readVolumeFile(
          `${PROJECT}_backups`,
          '20261113-100000-manual/db-data.tar.gz',
          (chunk) => {
            read.push(chunk);
          },
        );
        expect(Buffer.concat(read).toString()).toBe('archive bytes');
        await runtime.writeVolumeFile(
          `${PROJECT}_backups`,
          '20261113-100000-manual/db-data.tar.gz',
          (async function* () {
            yield Buffer.from('part one, ');
            yield Buffer.from('part two');
          })(),
        );
        expect(readFileSync(`${log}.stdin`, 'utf8')).toBe('part one, part two');
        const argv = readFileSync(log, 'utf8').trim().split('\n');
        expect(argv[0]).toBe(
          `run --rm -v ${PROJECT}_backups:/volume:ro alpine:3.22 cat -- /volume/20261113-100000-manual/db-data.tar.gz`,
        );
        expect(argv[1]).toContain(
          `run --rm -i -v ${PROJECT}_backups:/volume alpine:3.22 sh -c`,
        );
        expect(argv[1]).toEndWith(
          'sh /volume/20261113-100000-manual/db-data.tar.gz',
        );
        await expect(
          runtime.readVolumeFile(
            `${PROJECT}_backups`,
            '../etc/passwd',
            () => undefined,
          ),
        ).rejects.toThrow('Not a file path inside a volume');
      },
    );

    test('keeps no native snapshot: a snapshot here is an archive', async () => {
      const runtime = createDockerRuntime();
      expect(runtime.snapshotKind).toBe('archive');
      await expect(runtime.snapshot(['db-data'], 'tale-x')).rejects.toThrow(
        'Docker keeps no native volume snapshots',
      );
      await expect(runtime.restoreSnapshot({ kind: 'resume' })).rejects.toThrow(
        'Docker keeps no native volume snapshots',
      );
    });
  });
}
