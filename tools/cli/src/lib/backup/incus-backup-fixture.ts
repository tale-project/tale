// Test support for the backup modules on Incus: a fake Incus holding a small
// stack (db on db-data, backend on config-data, an empty backups volume), an
// IncusRuntime over it whose one-shot helpers run a model of the archive
// commands (`tar czf`, `tar xzf`, `sha256sum -c`) against the fake's volume
// files. Not imported by anything the CLI ships.

import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FakeFile, FakeIncus, FakeVolume } from '@tale/incus/fake';

import { stackIncus } from '../runtime/incus/apply/apply-fixture';
import { BACKUPS_VOLUME } from '../runtime/incus/apply/readback';
import type { IncusDeclaration } from '../runtime/incus/compile/stack-target';
import { IncusRuntime } from '../runtime/incus/incus-runtime';

const STACK = 'tale';
const POOL = 'tale';
const HELPER = 'tale-proxy-helper';

const DECLARATION: IncusDeclaration = {
  project: 'tale-stack',
  pool: POOL,
  network: {
    name: 'talebr0',
    subnet: '10.30.0.0/16',
    gateway: '10.30.0.1',
    block: '10.30.2.0/25',
  },
  sessions: { subnet: '10.31.0.0/24' },
  ingress: { mode: 'routed' },
};

export interface IncusBackupFixture {
  fake: FakeIncus;
  runtime: IncusRuntime;
  stateRoot: string;
  /** The files of a volume, by absolute path. */
  files(volume: string): Map<string, FakeFile>;
  /** One file's text, or undefined. */
  text(volume: string, path: string): string | undefined;
  /** Every helper command line, in order. */
  helperCommands: string[];
  remove(): void;
}

function volumes(fake: FakeIncus): Map<string, FakeVolume> {
  return (fake as unknown as { volumes: Map<string, FakeVolume> }).volumes;
}

function fileOf(text: string, uid = 0, gid = 0): FakeFile {
  return {
    content: text,
    bytes: Buffer.from(text),
    mode: '0600',
    uid,
    gid,
    type: 'file',
  };
}

/** The bytes of a file the fake holds. */
function bytesOf(file: FakeFile): Buffer {
  return Buffer.from(file.bytes ?? Buffer.from(file.content));
}

export function incusBackupFixture(
  options: { afterRestoreStep?: (volume: string, step: string) => void } = {},
): IncusBackupFixture {
  const fake = stackIncus();
  fake.addImage(HELPER);
  const stateRoot = mkdtempSync(join(tmpdir(), 'tale-incus-backup-'));
  const all = volumes(fake);
  const seed = (
    name: string,
    files: Record<string, FakeFile>,
    kind = 'data',
  ) => {
    const volume = fake.seedVolume(name, {
      'user.tale.stack': STACK,
      'user.tale.volume': name,
      'user.tale.kind': kind,
      'security.shifted': 'true',
      size: '1GiB',
    });
    volume.files = new Map(Object.entries(files));
  };
  seed('db-data', {
    '/PG_VERSION': fileOf('16\n', 999, 999),
    '/rows': fileOf('rows v1', 999, 999),
  });
  seed('config-data', {
    '/default/agents.json': fileOf('{"agents":1}', 1001, 1001),
  });
  seed(BACKUPS_VOLUME, {});
  seed(
    'sandbox-credentials',
    { '/client.key': fileOf('PRIVATE KEY') },
    'runtime',
  );
  const disk = (source: string, path: string) => ({
    type: 'disk',
    pool: POOL,
    source,
    path,
  });
  fake.seedInstance(
    'db',
    {
      'user.tale.stack': STACK,
      'user.tale.service': 'db',
      'user.tale.want': 'running',
    },
    {
      ephemeral: false,
      status: 'Running',
      devices: { 'db-data': disk('db-data', '/var/lib/postgresql/data') },
    },
  );
  fake.seedInstance(
    'backend',
    {
      'user.tale.stack': STACK,
      'user.tale.service': 'backend',
      'user.tale.want': 'running',
    },
    {
      ephemeral: false,
      status: 'Running',
      devices: { 'config-data': disk('config-data', '/app/data') },
    },
  );

  const helperCommands: string[] = [];
  const files = (name: string) => {
    const volume = all.get(name);
    if (volume === undefined) throw new Error(`no volume ${name}`);
    volume.files ??= new Map();
    return volume.files;
  };
  fake.exec = async (call, io) => {
    const line = call.command.join(' ');
    helperCommands.push(line);
    const mounted = (path: string) =>
      Object.values(call.instance.devices).find(
        (device) => device.path === path,
      )?.source;
    const data = mounted('/data');
    const backup = mounted('/backup');
    // The blob-store inspection: nothing seeded.
    if (line.includes('object-storage')) return 0;
    const archive = /tar czf \/backup\/([^/]+)\/([^ ]+)\.tar\.gz/.exec(line);
    if (archive !== null && data !== undefined && backup !== undefined) {
      const [, id, volume] = archive;
      // The model's archive: every file with its numeric owner.
      const body = Buffer.from(
        JSON.stringify(
          [...files(data).entries()].map(([path, file]) => [
            path,
            bytesOf(file).toString('base64'),
            file.uid ?? 0,
            file.gid ?? 0,
          ]),
        ),
      );
      const sha = createHash('sha256').update(body).digest('hex');
      files(backup).set(`/${id}/${volume}.tar.gz`, {
        ...fileOf(''),
        bytes: body,
        content: body.toString(),
      });
      files(backup).set(
        `/${id}/${volume}.tar.gz.sha256`,
        fileOf(`${sha}  ${volume}.tar.gz\n`),
      );
      io.write(1, `${sha}  ${volume}.tar.gz\n${body.byteLength}\n`);
      return 0;
    }
    const extract = /tar xzf \/backup\/([^/]+)\/([^ ]+)\.tar\.gz/.exec(line);
    if (extract !== null && data !== undefined && backup !== undefined) {
      const [, id, volume] = extract;
      const source = files(backup).get(`/${id}/${volume}.tar.gz`);
      if (source === undefined) return 1;
      const entries = JSON.parse(bytesOf(source).toString()) as [
        string,
        string,
        number,
        number,
      ][];
      for (const [path, content, uid, gid] of entries) {
        const raw = Buffer.from(content, 'base64');
        files(data).set(path, {
          content: raw.toString(),
          bytes: raw,
          mode: '0600',
          uid,
          gid,
          type: 'file',
        });
      }
      return 0;
    }
    if (line.includes('sha256sum -c') && backup !== undefined) {
      const dir = /cd \/backup\/([^ ]+) &&/.exec(line)?.[1];
      for (const [, sha, name] of line.matchAll(
        /echo "([0-9a-f]{64}) {2}([^"]+)" \| sha256sum -c/g,
      )) {
        const file = files(backup).get(`/${dir}/${name}`);
        if (
          file === undefined ||
          createHash('sha256').update(bytesOf(file)).digest('hex') !== sha
        ) {
          io.write(2, `${name}: FAILED`);
          return 1;
        }
      }
      return 0;
    }
    return 0;
  };
  const client = fake.client();
  const runtime = new IncusRuntime({
    client,
    declaration: DECLARATION,
    stack: STACK,
    stateRoot,
    healthchecks: () => ({ disabled: true }),
    helperImage: { alias: HELPER },
    snapshotHooks: {
      sleep: async () => undefined,
      ...(options.afterRestoreStep === undefined
        ? {}
        : { afterRestoreStep: options.afterRestoreStep }),
    },
  });
  return {
    fake,
    runtime,
    stateRoot,
    files,
    text: (volume, path) => {
      const file = all.get(volume)?.files?.get(path);
      return file === undefined ? undefined : bytesOf(file).toString();
    },
    helperCommands,
    remove() {
      fake.close();
      rmSync(stateRoot, { recursive: true, force: true });
    },
  };
}
