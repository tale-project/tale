import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { IncusClient, type IncusFetch } from '@tale/incus/client';
import { FakeIncus } from '@tale/incus/fake';

import type { StackImage, StackTarget } from '../compile/stack-target';
import type { InstanceSpec } from '../compile/translate';
import { PlanKey } from '../plan/digest';
import {
  desiredInstance,
  plan,
  volumeConfig,
  type DesiredStack,
  type PlanScope,
  type RenderedFile,
} from '../plan/plan';
import type { IncusDestination, IncusPlan } from '../plan/plan-model';
import {
  applyIncusPlan,
  type ApplyHooks,
  type ApplyOptions,
  type ApplyReceipt,
} from './apply';
import { readStack, type Readback } from './readback';

/**
 * Fixed inputs for the planner's and the applier's tests: the compiler's own
 * goldens as targets, the files a deploy writes beside them, a fake Incus
 * shaped like the stack project, and hooks that record what they were asked.
 */

const GOLDEN = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'compile',
  '__golden__',
);

/** A compiled target the compiler's tests hold (`managed-compose`,
 * `stateful`, `colour-blue`). */
export function goldenTarget(name: string): StackTarget {
  return JSON.parse(
    readFileSync(join(GOLDEN, `${name}.json`), 'utf8'),
  ) as StackTarget;
}

/** A secret the fixture `.env` carries; it must never leave a readback. */
export const SENTINEL_SECRET = 'fixture-db-password';

const DESTINATION: IncusDestination = {
  endpoint: 'https://incus.fake:8443',
  serverCertificateSha256: 'a'.repeat(64),
  project: 'tale-stack',
  pool: 'tale',
  architecture: 'x86_64',
};

export function testKey(seed = 7): PlanKey {
  return new PlanKey(new Uint8Array(32).fill(seed));
}

const text = (value: string) => new TextEncoder().encode(value);

/** The files a deploy writes for `target`: its own (bundle, credentials),
 * the resolver configuration and records, and the switch's upstreams. */
export function renderedFiles(
  target: StackTarget,
  records = 'v1',
): RenderedFile[] {
  const files: RenderedFile[] = target.files.map((file) => ({
    volume: file.volume,
    path: file.path,
    mode: file.mode,
    uid: 0,
    gid: 0,
    content: text(`${file.source.kind}:${file.source.file}\n`),
    write: 'overwrite',
  }));
  const volumes = new Set(target.volumes.map((volume) => volume.name));
  if (volumes.has('names-config'))
    for (const view of ['stack', 'sessions'] as const) {
      files.push({
        volume: 'names-config',
        path: `${view}/dnsmasq.conf`,
        mode: 0o644,
        uid: 0,
        gid: 0,
        content: text(`local-ttl=1\n# ${view}\n`),
        write: 'overwrite',
      });
      files.push({
        volume: 'names-config',
        path: `${view}/hosts/records`,
        mode: 0o644,
        uid: 0,
        gid: 0,
        content: text(
          `${Object.entries(target.names[view])
            .map(([name, addresses]) => `${addresses.join(' ')} ${name}`)
            .join('\n')}\n# ${records}\n`,
        ),
        write: 'generation',
      });
    }
  if (volumes.has('switch-config'))
    for (const [role, slots] of Object.entries(target.switch))
      files.push({
        volume: 'switch-config',
        path: `${role}.upstreams`,
        mode: 0o644,
        uid: 0,
        gid: 0,
        content: text(`to ${slots.join(' ')}\n`),
        write: 'overwrite',
        instance: 'switch',
      });
  return files;
}

export function desiredOf(
  target: StackTarget,
  key: PlanKey = testKey(),
  files: RenderedFile[] = renderedFiles(target),
): DesiredStack {
  return { target, files, destination: DESTINATION, key };
}

/** A fake Incus serving the stack project of the fixture declarations. */
export function stackIncus(): FakeIncus {
  return new FakeIncus({
    project: 'tale-stack',
    profile: 'tale-stack',
    network: 'talebr0',
    pool: 'tale',
    image: 'tale-unused',
  });
}

/** A client of `fake`, its requests passed through `wrap`. */
export function clientOf(
  fake: FakeIncus,
  wrap: (fetch: IncusFetch) => IncusFetch = (fetch) => fetch,
): IncusClient {
  return new IncusClient({
    endpoint: DESTINATION.endpoint,
    project: fake.options.project,
    tls: { ca: 'ca', cert: 'cert', key: 'key' },
    signal: () => undefined,
    fetch: wrap(fake.fetch),
    sleep: async () => undefined,
  });
}

export interface HookCall {
  hook: string;
  name: string;
  status?: string;
}

/** Hooks that act on the fake through `client` and record each call. */
export function recordingHooks(
  fake: FakeIncus,
  client: IncusClient,
  calls: HookCall[] = [],
): ApplyHooks & { calls: HookCall[] } {
  return {
    calls,
    async pullImage(image: StackImage) {
      calls.push({ hook: 'pullImage', name: image.alias });
      await client.pullOciImage(
        { server: 'https://ghcr.io', alias: image.reference },
        image.alias,
        60_000,
      );
    },
    async waitHealthy(instance: InstanceSpec) {
      const status = fake.instances.get(instance.name)?.status;
      calls.push({ hook: 'waitHealthy', name: instance.name, status });
      if (status !== 'Running')
        throw new Error(`${instance.name} is not running (${status}).`);
    },
    async drainSandbox(name: string) {
      calls.push({
        hook: 'drainSandbox',
        name,
        status: fake.instances.get(name)?.status,
      });
    },
    async drainBackend(name: string) {
      calls.push({
        hook: 'drainBackend',
        name,
        status: fake.instances.get(name)?.status,
      });
    },
    async withdraw(name: string, service: string) {
      calls.push({
        hook: 'withdraw',
        name,
        status: fake.instances.get(name)?.status,
      });
      return service === 'platform'
        ? '/tmp/platform-withdrawn'
        : '/tmp/backend-withdrawn';
    },
    async admit(name: string, marker: string) {
      calls.push({ hook: 'admit', name: `${name}:${marker}` });
    },
  };
}

/** Read back, plan and return both. */
export async function planned(
  client: IncusClient,
  desired: DesiredStack,
  scope: PlanScope = { phase: 'full', stop: false },
): Promise<{ readback: Readback; plan: IncusPlan }> {
  const readback = await readStack(client, {
    stack: desired.target.stack,
    pool: desired.target.pool,
    key: desired.key,
    files: desired.files.map((file) => ({
      volume: file.volume,
      path: file.path,
      write: file.write,
    })),
  });
  return { readback, plan: plan(desired, readback, scope) };
}

export const FIXED_NOW = () => new Date('2026-11-13T10:00:00.000Z');

/** Read back, plan and apply in one go, as a deploy does. */
export async function converge(
  client: IncusClient,
  hooks: ApplyHooks,
  stateRoot: string,
  desired: DesiredStack,
  scope: PlanScope = { phase: 'full', stop: false },
  options: Partial<ApplyOptions> = {},
): Promise<{ plan: IncusPlan; receipt: ApplyReceipt }> {
  const { plan: made } = await planned(client, desired, scope);
  const receipt = await applyIncusPlan({
    client,
    stateRoot,
    desired,
    plan: made,
    hooks,
    options: { stop: scope.stop, now: FIXED_NOW, ...options },
  });
  return { plan: made, receipt };
}

/** A state root of its own, removed by the returned function. */
export function stateRootFixture(): { root: string; remove(): void } {
  const root = mkdtempSync(join(tmpdir(), 'tale-incus-apply-'));
  return {
    root,
    remove: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** `target` with `services` on a new image digest (a release upgrade). */
export function withNewImage(
  target: StackTarget,
  repository: string,
  digestHex: string,
): StackTarget {
  const next = structuredClone(target);
  const image = next.images.find((candidate) =>
    candidate.reference.includes(`/${repository}@`),
  );
  if (image === undefined) throw new Error(`No image ${repository}.`);
  const oldAlias = image.alias;
  const newAlias = `${repository}-${digestHex.slice(0, 32)}`;
  image.alias = newAlias;
  image.digest = `sha256:${digestHex}`;
  image.reference = `${image.reference.split('@')[0]}@sha256:${digestHex}`;
  for (const instance of next.instances)
    if (instance.image === oldAlias) {
      instance.image = newAlias;
      instance.config['user.tale.image'] = image.digest;
    }
  return next;
}

/** What the fake holds, in a form two runs can be compared by: generation
 * numbers and Incus's own keys left out. */
export function holdings(fake: FakeIncus): unknown {
  const instances = Object.fromEntries(
    [...fake.instances.values()]
      .map((instance) => [
        instance.name,
        {
          status: instance.status,
          config: Object.fromEntries(
            Object.entries(instance.config)
              .filter(([key]) => !key.startsWith('volatile.'))
              .sort(([left], [right]) => left.localeCompare(right)),
          ),
          devices: instance.devices,
        },
      ])
      .sort(([left], [right]) => String(left).localeCompare(String(right))),
  );
  const volumes = Object.fromEntries(
    [...fake.volumes.values()]
      .map((volume) => [
        volume.name,
        {
          config: volume.config,
          files: Object.fromEntries(
            [...(volume.files ?? new Map()).entries()]
              .filter(([, file]) => file.type !== 'directory')
              .map(([path, file]) => [
                path.replace(/\.\d+(\.json)?$/, '.<gen>$1'),
                { content: file.content, mode: file.mode, uid: file.uid },
              ])
              .sort(([left], [right]) =>
                String(left).localeCompare(String(right)),
              ),
          ),
        },
      ])
      .sort(([left], [right]) => String(left).localeCompare(String(right))),
  );
  return {
    instances,
    volumes,
    aliases: [...fake.aliases.keys()].sort(),
  };
}

/** The readback of a stack that converged on `desired`: what the planner
 * must find unchanged. */
export function convergedReadback(desired: DesiredStack): Readback {
  const { target, key } = desired;
  const volumes = target.volumes.some((volume) => volume.name === 'backups')
    ? target.volumes
    : [
        ...target.volumes,
        {
          name: 'backups',
          kind: 'data' as const,
          pool: target.pool,
          config: {},
        },
      ];
  return {
    stack: target.stack,
    pool: target.pool,
    instances: target.instances.map((spec) => {
      const want = desiredInstance(spec, desired);
      return {
        name: spec.name,
        revision: `"etag-${spec.name}"`,
        status: 'Running',
        running: true,
        config: {
          ...want.config,
          'user.tale.config': want.sha256,
          'user.tale.want': 'running',
          'volatile.base_image': 'f'.repeat(64),
        },
        devices: spec.devices,
        profiles: ['tale-stack'],
        createdAt: '2026-11-13T09:00:00Z',
        custody: { verdict: 'stack' as const },
      };
    }),
    volumes: volumes.map((volume) => ({
      name: volume.name,
      config: volumeConfig(volume, target.stack),
      usedBy: [],
      custody: { verdict: 'stack' as const },
    })),
    aliases: Object.fromEntries(
      target.images.map((image) => [image.alias, 'f'.repeat(64)]),
    ),
    files: desired.files
      .filter((file) => file.instance === undefined)
      .map((file) => ({
        volume: file.volume,
        path: file.path,
        generation: file.write === 'generation' ? 1 : null,
        sha256: key.digestBytes(file.content),
        mode: file.mode,
        uid: file.uid,
        gid: file.gid,
      })),
    record: {
      schemaVersion: 1,
      stack: target.stack,
      deployedAt: '2026-11-12T10:00:00.000Z',
    },
    manifests: false,
  };
}

/** An empty project: a first deploy. */
export function emptyReadback(desired: DesiredStack): Readback {
  return {
    stack: desired.target.stack,
    pool: desired.target.pool,
    instances: [],
    volumes: [],
    aliases: {},
    files: [],
    record: null,
    manifests: false,
  };
}
