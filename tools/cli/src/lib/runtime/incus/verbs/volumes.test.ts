import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FakeFile, FakeIncus } from '@tale/incus/fake';

import { CliError } from '../../../../utils/fail';
import type { RegistryClient } from '../../../oci/registry';
import { clientOf, goldenTarget, stackIncus } from '../apply/apply-fixture';
import type { IncusDeclaration, StackTarget } from '../compile/stack-target';
import { IncusRuntime } from '../incus-runtime';
import type { ImageFsFacts } from './image-facts-cache';
import {
  assertPoolUnchanged,
  ensureStackVolumes,
  listStackVolumes,
  mountPointsByDigest,
  removeStackVolume,
  volumeOwners,
} from './volumes';

let fake: FakeIncus;
let stateRoot: string;
let target: StackTarget;

beforeEach(() => {
  fake = stackIncus();
  stateRoot = mkdtempSync(join(tmpdir(), 'tale-incus-volumes-'));
  target = goldenTarget('managed-compose');
});

afterEach(() => {
  rmSync(stateRoot, { recursive: true, force: true });
});

/** Facts in which every mount point of `target` is a directory of `owner`. */
function factsOf(
  owner: { uid: number; gid: number } = { uid: 1000, gid: 1000 },
): Map<string, ImageFsFacts> {
  const facts = new Map<string, ImageFsFacts>();
  for (const [digest, paths] of mountPointsByDigest(target))
    facts.set(digest, {
      digest,
      paths: Object.fromEntries(
        paths.map((path) => [
          path,
          { type: 'directory' as const, ...owner, mode: '0755' },
        ]),
      ),
      appUser: null,
      timeout: null,
      infraFormats: [],
      readAt: '2026-11-13T00:00:00.000Z',
    });
  return facts;
}

const platformDigest = () =>
  target.images.find((image) => image.alias.startsWith('tale-platform-'))
    ?.digest ?? '';
const egressDigest = () =>
  target.images.find((image) => image.alias.startsWith('tale-sandbox-egress-'))
    ?.digest ?? '';

describe('volume owners', () => {
  test('each volume takes the owner of its mount point in its first user', () => {
    const facts = factsOf();
    const db = target.images.find((image) =>
      image.alias.startsWith('tale-db-'),
    );
    const record = facts.get(db?.digest ?? '');
    if (record === undefined) throw new Error('no db facts');
    record.paths['/var/lib/postgresql/data'] = {
      type: 'directory',
      uid: 70,
      gid: 70,
      mode: '0700',
    };
    const owners = volumeOwners(target, facts);
    expect(owners.get('db-data')).toEqual({ uid: 70, gid: 70, mode: '0700' });
    expect(owners.get('config-data')).toEqual({
      uid: 1000,
      gid: 1000,
      mode: '0755',
    });
    // `backups` is mounted by no service: Incus's own default.
    expect(owners.has('backups')).toBe(false);
  });

  test('a mount point the image lacks makes a root-owned volume, with a warning', () => {
    const facts = factsOf();
    const record = facts.get(platformDigest());
    if (record === undefined) throw new Error('no platform facts');
    record.paths['/app/static-assets'] = null;
    const warnings: string[] = [];
    const owners = volumeOwners(target, facts, (line) => warnings.push(line));
    expect(owners.get('static-assets')).toEqual({
      uid: 0,
      gid: 0,
      mode: '0755',
    });
    expect(warnings).toEqual([
      expect.stringContaining(
        'Volume static-assets is made root-owned (0755): no image holds its mount point (platform-1:/app/static-assets)',
      ),
    ]);
  });

  test('a mount point the image holds as a file is refused', () => {
    const facts = factsOf();
    const record = facts.get(platformDigest());
    if (record === undefined) throw new Error('no platform facts');
    record.paths['/app/static-assets'] = {
      type: 'file',
      uid: 0,
      gid: 0,
      mode: '0644',
    };
    let error: unknown;
    try {
      volumeOwners(target, facts);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).message).toContain(
      'static-assets at /app/static-assets in platform-1: the image has a file there',
    );
  });

  test('a runtime volume whose mount point is missing is made for root', () => {
    const facts = factsOf();
    const record = facts.get(egressDigest());
    if (record === undefined) throw new Error('no egress facts');
    record.paths['/names'] = null;
    expect(volumeOwners(target, facts).get('names-config')).toEqual({
      uid: 0,
      gid: 0,
      mode: '0755',
    });
  });

  test('users that disagree about an owner are named in a warning', () => {
    const facts = factsOf();
    const sandbox = target.images.find((image) =>
      image.alias.startsWith('tale-sandbox-2'),
    );
    const record = facts.get(sandbox?.digest ?? '');
    if (record === undefined) throw new Error('no sandbox facts');
    record.paths['/app/platform-config'] = {
      type: 'directory',
      uid: 2000,
      gid: 2000,
      mode: '0755',
    };
    const warnings: string[] = [];
    const owners = volumeOwners(target, facts, (line) => warnings.push(line));
    expect(owners.get('config-data')?.uid).toBe(1000);
    expect(warnings).toEqual([
      expect.stringContaining(
        'sandbox expects /app/platform-config as 2000:2000',
      ),
    ]);
  });
});

describe('the stack volumes', () => {
  test('are made shifted and labelled, with their owner, and kept once made', async () => {
    const client = clientOf(fake);
    const owners = volumeOwners(target, factsOf());
    const created = await ensureStackVolumes(
      client,
      target,
      target.volumes,
      owners,
    );
    expect(created).toEqual(target.volumes.map((volume) => volume.name));
    expect(fake.volumes.get('db-data')?.config).toEqual({
      'snapshots.expiry': '14d',
      size: '50GiB',
      'security.shifted': 'true',
      'user.tale.stack': 'tale',
      'user.tale.volume': 'db-data',
      'user.tale.kind': 'data',
      'initial.uid': '1000',
      'initial.gid': '1000',
      'initial.mode': '0755',
    });
    expect(
      await ensureStackVolumes(client, target, target.volumes, owners),
    ).toEqual([]);
    expect(
      (await listStackVolumes(client, 'tale', 'tale')).map((volume) => [
        volume.name,
        volume.kind,
      ]),
    ).toContainEqual(['names-config', 'runtime']);
  });

  test("another stack's volume of the same name is refused, never adopted", async () => {
    fake.seedVolume('db-data', { 'user.tale.stack': 'other' });
    let error: unknown;
    try {
      await ensureStackVolumes(
        clientOf(fake),
        target,
        target.volumes,
        volumeOwners(target, factsOf()),
      );
    } catch (caught) {
      error = caught;
    }
    expect((error as Error).message).toContain('belongs to the stack other');
  });

  test('a pool change is refused', async () => {
    fake.seedVolume('db-data', { 'user.tale.stack': 'tale' });
    fake.seedInstance(
      'db',
      { 'user.tale.stack': 'tale' },
      {
        status: 'Stopped',
        ephemeral: false,
        devices: {
          'db-data': {
            type: 'disk',
            pool: 'old-pool',
            source: 'db-data',
            path: '/var/lib/postgresql/data',
          },
        },
      },
    );
    let error: unknown;
    try {
      await assertPoolUnchanged(clientOf(fake), target);
    } catch (caught) {
      error = caught;
    }
    expect((error as Error).message).toContain('db-data on old-pool');
    await assertPoolUnchanged(clientOf(fake), { ...target, stack: 'other' });
  });

  test('removal refuses a volume in use or not the stack, and is idempotent', async () => {
    const client = clientOf(fake);
    fake.seedVolume('config-data', { 'user.tale.stack': 'tale' });
    fake.seedVolume('foreign', { 'user.tale.stack': 'other' });
    fake.seedInstance(
      'platform-1',
      { 'user.tale.stack': 'tale' },
      {
        devices: {
          'config-data': {
            type: 'disk',
            pool: 'tale',
            source: 'config-data',
            path: '/app/data',
          },
        },
      },
    );
    const refusal = async (name: string) => {
      try {
        await removeStackVolume(client, 'tale', 'tale', name);
      } catch (error) {
        return (error as Error).message;
      }
      return '';
    };
    expect(await refusal('config-data')).toContain('still used by platform-1');
    expect(await refusal('foreign')).toContain('belongs to the stack other');
    fake.instances.delete('platform-1');
    expect(await removeStackVolume(client, 'tale', 'tale', 'config-data')).toBe(
      true,
    );
    expect(await removeStackVolume(client, 'tale', 'tale', 'config-data')).toBe(
      false,
    );
  });
});

describe('the Incus runtime makes the volumes from what the images hold', () => {
  const declaration: IncusDeclaration = {
    project: 'tale-stack',
    pool: 'tale',
    network: {
      name: 'talebr0',
      subnet: '10.30.0.0/16',
      gateway: '10.30.0.1',
      block: '10.30.2.0/25',
    },
    sessions: { subnet: '10.31.0.0/24' },
    ingress: { mode: 'routed' },
  };
  /** A registry that knows every image of the target, with no labels. */
  const registry: RegistryClient = {
    resolve: async (reference) => ({
      reference,
      digest: `sha256:${reference.split('@sha256:')[1] ?? ''}`,
      manifestDigest: 'sha256:'.padEnd(71, '0'),
      configDigest: 'sha256:'.padEnd(71, '1'),
      os: 'linux',
      architecture: 'amd64',
      variant: null,
      config: { config: { Env: ['PATH=/usr/bin:/bin'], Labels: {} } },
    }),
  };

  test('pulls, reads the facts once per image, and makes every volume', async () => {
    const runtime = new IncusRuntime({
      client: clientOf(fake),
      declaration,
      stack: 'tale',
      stateRoot,
      registry,
    });
    await runtime.ensureTargetImages(target);
    for (const [digest, paths] of mountPointsByDigest(target)) {
      const alias = target.images.find(
        (image) => image.digest === digest,
      )?.alias;
      const files = new Map<string, FakeFile>(
        paths.map((path) => [
          path,
          {
            content: '',
            type: 'directory',
            uid: 1000,
            gid: 1000,
            mode: '0750',
          },
        ]),
      );
      fake.imageFiles.set(fake.aliases.get(alias ?? '') ?? '', files);
    }
    const made = await runtime.ensureStackVolumes(target);
    expect(made).toHaveLength(target.volumes.length);
    expect(fake.volumes.get('db-data')?.config['initial.mode']).toBe('0750');
    expect(runtime.volumeOwner({ name: 'proxy-files' })).toEqual({
      uid: 1000,
      gid: 1000,
      mode: '0750',
    });
    // One probe instance per image that mounts a volume, none left behind.
    expect(fake.seen('POST /1.0/instances')).toHaveLength(target.images.length);
    expect(fake.names()).toEqual([]);
    expect(await runtime.ensureVolumes(['db-data'])).toBe(true);
    expect(fake.seen('POST /1.0/instances')).toHaveLength(target.images.length);
  });
});
