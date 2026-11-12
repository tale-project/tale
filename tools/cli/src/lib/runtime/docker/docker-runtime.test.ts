import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
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

import { REQUIRED_VOLUMES } from '../../compose/generators/constants';
import { setProjectId } from '../../project/project-context';
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
  isolatedSuite();
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

/** A host that runs `LIVE` on the blue colour: the stateful tier, the
 *  sidecar and one replica of each colour role. */
function seedLiveBlue(fake: FakeRuntime): void {
  for (const name of REQUIRED_VOLUMES) fake.seedVolume(`${PROJECT}_${name}`);
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
  const database = {
    DATABASE_URL: 'postgresql://tale:synthetic@db:5432/tale_app',
  };
  const blue = `${PROJECT}-blue`;
  const platform = `${REGISTRY}/tale-platform:${LIVE}`;
  fake.seedInstance({
    stack: blue,
    service: 'platform',
    image: platform,
    mounts: [volume('config-data', '/app/data', true)],
    networks: [`${PROJECT}_internal`],
  });
  fake.seedInstance({
    stack: blue,
    service: 'backend-api',
    image: platform,
    mounts: [volume('config-data', '/app/data')],
    networks: [`${PROJECT}_internal`, 'tale-sandbox-net'],
    environment: database,
  });
  fake.seedInstance({
    stack: blue,
    service: 'backend-worker',
    image: platform,
    mounts: [volume('config-data', '/app/data')],
    networks: [`${PROJECT}_internal`],
    health: 'none',
    environment: database,
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
  'docker container inspect <demo-abc123-blue-backend-api-1> <demo-abc123-blue-backend-worker-1> | silent timeout=15 max=1048576 env',
  'docker image inspect sha256:<image ghcr.io/tale-project/tale/tale-platform:0.6.0> | silent timeout=15 max=1048576 env',
  'docker container inspect <demo-abc123-db> | silent timeout=15 max=1048576 env',
  'docker exec -i <demo-abc123-db> sh -s | silent timeout=15 max=1048576 env stdin=b09c49e4fe79',
  'docker container inspect <demo-abc123-db> | silent timeout=15 max=1048576 env',
  'docker ps -a --no-trunc --filter label=com.docker.compose.project=demo-abc123 --format {{.ID}}\t{{.Label "com.docker.compose.service"}} | silent timeout=15 max=1048576 env',
  'docker ps -a --no-trunc --filter label=com.docker.compose.project=demo-abc123-blue --format {{.ID}}\t{{.Label "com.docker.compose.service"}} | silent timeout=15 max=1048576 env',
  'docker ps -a --no-trunc --filter label=com.docker.compose.project=demo-abc123-green --format {{.ID}}\t{{.Label "com.docker.compose.service"}} | silent timeout=15 max=1048576 env',
  'docker container inspect <demo-abc123-blue-backend-api-1> <demo-abc123-blue-backend-worker-1> | silent timeout=15 max=1048576 env',
  'docker image inspect sha256:<image ghcr.io/tale-project/tale/tale-platform:0.6.0> | silent timeout=15 max=1048576 env',
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123-blue --filter label=com.docker.compose.service=platform --format \u00ab4fc2b80a78e6\u00bb',
  'docker container inspect --format \u00ab981aa748b02d\u00bb demo-abc123-blue-platform-1',
  'docker container inspect --format {{.State.Running}} demo-abc123-db',
  'docker container inspect --format {{.State.Running}} demo-abc123-object-store',
  'docker container inspect --format {{.State.Running}} demo-abc123-proxy',
  'docker pull ghcr.io/tale-project/tale/tale-platform:0.6.1',
  'docker pull ghcr.io/tale-project/tale/tale-sandbox-llm-gateway:0.6.1',
  'docker pull ghcr.io/tale-project/tale/tale-sandbox:0.6.1',
  'docker pull ghcr.io/tale-project/tale/tale-sandbox-egress:0.6.1',
  'docker pull ghcr.io/tale-project/tale/tale-sandbox-runtime:0.6.1',
  'docker pull ghcr.io/tale-project/tale/tale-sandbox-buildkitd:0.6.1',
  'docker image inspect ghcr.io/tale-project/tale/tale-platform:0.6.1 | silent timeout=15 max=1048576 env',
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123-green --filter label=com.docker.compose.service=platform --format \u00ab4fc2b80a78e6\u00bb',
  'docker ps -a --no-trunc --filter label=com.docker.compose.project=demo-abc123 --filter label=com.docker.compose.service=db --format {{.ID}} | silent timeout=15 max=1048576 env',
  'docker ps -a --no-trunc --filter label=com.docker.compose.project=demo-abc123 --format {{.ID}}\t{{.Label "com.docker.compose.service"}} | silent timeout=15 max=1048576 env',
  'docker ps -a --no-trunc --filter label=com.docker.compose.project=demo-abc123-blue --format {{.ID}}\t{{.Label "com.docker.compose.service"}} | silent timeout=15 max=1048576 env',
  'docker ps -a --no-trunc --filter label=com.docker.compose.project=demo-abc123-green --format {{.ID}}\t{{.Label "com.docker.compose.service"}} | silent timeout=15 max=1048576 env',
  'docker container inspect <demo-abc123-blue-backend-api-1> <demo-abc123-blue-backend-worker-1> | silent timeout=15 max=1048576 env',
  'docker image inspect sha256:<image ghcr.io/tale-project/tale/tale-platform:0.6.0> | silent timeout=15 max=1048576 env',
  'docker container inspect <demo-abc123-db> | silent timeout=15 max=1048576 env',
  'docker exec -i <demo-abc123-db> sh -s | silent timeout=15 max=1048576 env stdin=b09c49e4fe79',
  'docker container inspect <demo-abc123-db> | silent timeout=15 max=1048576 env',
  'docker ps -a --no-trunc --filter label=com.docker.compose.project=demo-abc123 --format {{.ID}}\t{{.Label "com.docker.compose.service"}} | silent timeout=15 max=1048576 env',
  'docker ps -a --no-trunc --filter label=com.docker.compose.project=demo-abc123-blue --format {{.ID}}\t{{.Label "com.docker.compose.service"}} | silent timeout=15 max=1048576 env',
  'docker ps -a --no-trunc --filter label=com.docker.compose.project=demo-abc123-green --format {{.ID}}\t{{.Label "com.docker.compose.service"}} | silent timeout=15 max=1048576 env',
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
  'docker volume inspect demo-abc123_object-store-data',
  'docker volume inspect demo-abc123_caddy-data',
  'docker volume inspect demo-abc123_caddy-config',
  'docker volume inspect demo-abc123_llm-gateway-data',
  'docker volume inspect demo-abc123_backups',
  'docker volume create --label project=demo-abc123 demo-abc123_backups',
  'docker ps -q --filter volume=demo-abc123_db-data',
  'docker ps -q --filter volume=demo-abc123_config-data',
  'docker ps -q --filter volume=demo-abc123_object-store-data',
  'docker ps -q --filter volume=demo-abc123_caddy-data',
  'docker ps -q --filter volume=demo-abc123_caddy-config',
  'docker ps -q --filter volume=demo-abc123_llm-gateway-data',
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
  'docker ps -q --filter volume=demo-abc123_llm-gateway-data',
  'docker container inspect --format \u00ab91a7d366815f\u00bb <demo-abc123-sandbox-llm-gateway>',
  'docker pause <demo-abc123-sandbox-llm-gateway>',
  'docker run --rm -v demo-abc123_llm-gateway-data:/data:ro -v demo-abc123_backups:/backup alpine:3.22 sh -c \u00abafebf84da42b\u00bb | timeout=1800',
  'docker unpause <demo-abc123-sandbox-llm-gateway>',
  'docker container inspect --format \u00ab91a7d366815f\u00bb <demo-abc123-sandbox-llm-gateway>',
  'docker run --rm -i -v demo-abc123_backups:/backup alpine:3.22 sh -c cat > /backup/<snapshot>/manifest.json | stdin=d56dd5ea8e17',
  'docker volume inspect demo-abc123_backups',
  'docker run --rm -v demo-abc123_backups:/backup:ro alpine:3.22 sh -c for f in /backup/*/manifest.json; do [ -f "$f" ] && cat "$f" && echo; done; true',
  'docker run --rm -v demo-abc123_backups:/backup:ro alpine:3.22 sh -c for d in /backup/*/; do [ -f "${d}manifest.json" ] || basename "$d"; done; true',
  'docker ps -a --no-trunc --filter label=com.docker.compose.project=demo-abc123 --filter label=com.docker.compose.service=db --format {{.ID}} | silent timeout=15 max=1048576 env',
  'docker ps -a --no-trunc --filter label=com.docker.compose.project=demo-abc123 --format {{.ID}}\t{{.Label "com.docker.compose.service"}} | silent timeout=15 max=1048576 env',
  'docker ps -a --no-trunc --filter label=com.docker.compose.project=demo-abc123-blue --format {{.ID}}\t{{.Label "com.docker.compose.service"}} | silent timeout=15 max=1048576 env',
  'docker ps -a --no-trunc --filter label=com.docker.compose.project=demo-abc123-green --format {{.ID}}\t{{.Label "com.docker.compose.service"}} | silent timeout=15 max=1048576 env',
  'docker container inspect <demo-abc123-blue-backend-api-1> <demo-abc123-blue-backend-worker-1> | silent timeout=15 max=1048576 env',
  'docker image inspect sha256:<image ghcr.io/tale-project/tale/tale-platform:0.6.0> | silent timeout=15 max=1048576 env',
  'docker container inspect <demo-abc123-db> | silent timeout=15 max=1048576 env',
  'docker exec -i <demo-abc123-db> sh -s | silent timeout=15 max=1048576 env stdin=b09c49e4fe79',
  'docker container inspect <demo-abc123-db> | silent timeout=15 max=1048576 env',
  'docker ps -a --no-trunc --filter label=com.docker.compose.project=demo-abc123 --format {{.ID}}\t{{.Label "com.docker.compose.service"}} | silent timeout=15 max=1048576 env',
  'docker ps -a --no-trunc --filter label=com.docker.compose.project=demo-abc123-blue --format {{.ID}}\t{{.Label "com.docker.compose.service"}} | silent timeout=15 max=1048576 env',
  'docker ps -a --no-trunc --filter label=com.docker.compose.project=demo-abc123-green --format {{.ID}}\t{{.Label "com.docker.compose.service"}} | silent timeout=15 max=1048576 env',
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
  'docker volume inspect demo-abc123_db-data',
  'docker volume inspect demo-abc123_db-backup',
  'docker volume inspect demo-abc123_object-store-data',
  'docker volume inspect demo-abc123_llm-gateway-data',
  'docker network inspect demo-abc123_internal',
  'docker network inspect tale-sandbox-net',
  'docker network inspect --format {{.Internal}}|{{.EnableIPv6}} tale-sandbox-net',
  'docker container inspect --format \u00ab981aa748b02d\u00bb demo-abc123-sandbox',
  'docker container inspect --format {{.State.Running}} demo-abc123-sandbox',
  'docker exec demo-abc123-sandbox sh -c \u00ab5bbd5d50106f\u00bb',
  'docker exec demo-abc123-sandbox sh -c \u00ab9fd85dd96812\u00bb',
  'docker compose -p demo-abc123 -f <deploy-dir>/<compose> up -d sandbox-llm-gateway sandbox sandbox-egress | cwd=<deploy-dir>',
  'docker container inspect --format {{.State.Running}} demo-abc123-sandbox-llm-gateway',
  'docker container inspect --format {{.State.Health.Status}} demo-abc123-sandbox-llm-gateway',
  'docker container inspect --format {{.State.Running}} demo-abc123-sandbox',
  'docker container inspect --format {{.State.Health.Status}} demo-abc123-sandbox',
  'docker container inspect --format {{.State.Running}} demo-abc123-sandbox-egress',
  'docker container inspect --format {{.State.Health.Status}} demo-abc123-sandbox-egress',
  'docker compose -p demo-abc123 -f <deploy-dir>/<compose> up -d bgutil-provider | cwd=<deploy-dir>',
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123-blue --filter label=com.docker.compose.service=platform --format \u00ab4fc2b80a78e6\u00bb',
  'docker container inspect --format \u00ab981aa748b02d\u00bb demo-abc123-blue-platform-1',
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123-green --filter label=com.docker.compose.service=platform --format \u00ab4fc2b80a78e6\u00bb',
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
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123-green --filter label=com.docker.compose.service=backend-api --format \u00ab4fc2b80a78e6\u00bb',
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123 --filter label=com.docker.compose.service=backend-api --format \u00ab4fc2b80a78e6\u00bb',
  'docker exec demo-abc123-green-backend-api-1 sh -c \u00abcf4507e58178\u00bb',
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123-blue --filter label=com.docker.compose.service=backend-api --format \u00ab4fc2b80a78e6\u00bb',
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123-green --filter label=com.docker.compose.service=backend-api --format \u00ab4fc2b80a78e6\u00bb',
  'docker ps -a --filter label=com.docker.compose.project=demo-abc123 --filter label=com.docker.compose.service=backend-api --format \u00ab4fc2b80a78e6\u00bb',
];

/** The fake `docker` on the `PATH` is a POSIX shell script. */
const testPosix = test.skipIf(process.platform === 'win32');

function isolatedSuite(): void {
  let fake = new FakeRuntime();
  let cli = fakeDockerCli(fake);
  let calls: RecordedCall[] = [];
  mock.module('../../docker/exec', () => ({
    exec: async (
      command: string,
      args: string[],
      options: RecordedCall['options'] = {},
    ) => {
      calls.push({ command, args: [...args], options });
      return cli(command, args, options);
    },
  }));

  let deployDir = '';
  beforeEach(() => {
    fake = new FakeRuntime();
    cli = fakeDockerCli(fake);
    calls = [];
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
          BACKEND_UPSTREAM: '',
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
      expect(readFileSync(join(deployDir, 'tale.json'), 'utf8')).toContain(
        PROJECT,
      );
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
  });
}
