import { posix } from 'node:path';

import type { IncusClient } from '@tale/incus/client';
import { readFile } from '@tale/incus/files';
import { z } from 'zod';

import { preconditionError } from '../../../../utils/fail';
import {
  pickInstanceEnvironment,
  type InstanceInfo,
  type InstanceMount,
} from '../../types';
import type { Devices } from '../compile/translate';
import type { PlanKey } from '../plan/digest';

/**
 * What the Incus project holds for a stack, read once per plan (design D-07):
 * the planner diffs the target against it, and the same read is custody
 * (whose instance is this?), `status` and crash-resume.
 *
 * A readback holds the instances' configuration, secrets included, in memory
 * only; everything that leaves it (a plan, an `InstanceInfo`, a refusal)
 * carries digests and the allow-listed keys alone (design D-34, R-15).
 */

const STACK_LABEL = 'user.tale.stack';
/** The volume that holds the deploy record and the snapshot manifests. */
export const BACKUPS_VOLUME = 'backups';
/** A restore's holder of the volume it replaced: `<v>.pre-restore-<ts>`. */
const PRE_RESTORE_MARKER = '.pre-restore-';

/** Whose an instance or a volume is, by its `user.tale.stack` label. */
export type Custody =
  | { verdict: 'stack' }
  | { verdict: 'foreign'; stack: string }
  | { verdict: 'unlabelled' };

export function custodyOf(
  config: Readonly<Record<string, string>>,
  stack: string,
): Custody {
  const label = config[STACK_LABEL];
  if (label === undefined || label === '') return { verdict: 'unlabelled' };
  return label === stack
    ? { verdict: 'stack' }
    : { verdict: 'foreign', stack: label };
}

export interface ObservedInstance {
  name: string;
  /** The ETag it was read with. */
  revision: string | null;
  /** Incus's word for its state: Running, Stopped, Frozen, … */
  status: string;
  running: boolean;
  config: Readonly<Record<string, string>>;
  devices: Devices;
  profiles: readonly string[];
  createdAt: string;
  custody: Custody;
}

export interface ObservedVolume {
  name: string;
  config: Readonly<Record<string, string>>;
  /** Names of the instances that mount it. */
  usedBy: string[];
  custody: Custody;
}

export interface ObservedFile {
  volume: string;
  /** The desired path it answers to, relative to the volume's root. */
  path: string;
  /** For a file written by generation (`<path>.<gen>`), its generation. */
  generation: number | null;
  /** The keyed digest of its content. */
  sha256: string;
  mode: number;
  uid: number;
  gid: number;
}

/** `backups/stack.json`: when the stack was first deployed, and reset. */
export const stackRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  stack: z.string().min(1).max(128),
  deployedAt: z.string().datetime().optional(),
  resetAt: z.string().datetime().optional(),
});
export type StackRecord = z.infer<typeof stackRecordSchema>;

export interface Readback {
  stack: string;
  pool: string;
  /** Every instance of the project, whoever's. */
  instances: ObservedInstance[];
  /** Every custom volume of the pool in the project. */
  volumes: ObservedVolume[];
  /** Image alias → fingerprint. */
  aliases: Readonly<Record<string, string>>;
  /** The files the target writes, as found (every generation of each). */
  files: ObservedFile[];
  /** The newest deploy record that parses, or null. */
  record: StackRecord | null;
  /** Whether `backups` holds a snapshot manifest. */
  manifests: boolean;
}

export interface ReadbackRequest {
  stack: string;
  pool: string;
  key: PlanKey;
  /** The files to look for, as the target names them. */
  files: readonly {
    volume: string;
    path: string;
    write: 'overwrite' | 'generation';
  }[];
}

/** A file written by generation answers to `<path>.<gen>`. */
const GENERATION = /^\d{1,12}$/;
/** The deploy record: `stack.json`, or `stack.<gen>.json` (R3-29). */
const RECORD_FILE = /^stack(?:\.(\d{1,12}))?\.json$/;
const MANIFEST_FILE = /^manifest(?:\.\d{1,12})?\.json$/;
/** How many snapshot directories the "deployed before" check opens. */
const MANIFEST_SCAN_LIMIT = 64;
const RECORD_MAX_BYTES = 64 * 1024;

function volumeTarget(pool: string, volume: string) {
  return { pool, volume };
}

/** `/1.0/instances/<name>?project=…` → `<name>`. */
function instanceOfUrl(url: string): string {
  const path = url.split('?')[0] ?? '';
  return decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
}

function octal(mode: string): number {
  return Number.parseInt(mode, 8);
}

/** Read what the project holds for the stack. */
export async function readStack(
  client: IncusClient,
  request: ReadbackRequest,
): Promise<Readback> {
  const listed = await client.listInstances();
  const instances: ObservedInstance[] = [];
  for (const instance of listed) {
    // The list carries no ETag; read each instance of the stack, and each
    // whose name the stack might need, once more for it.
    const read = await client.getInstance(instance.name);
    if (read === undefined) continue;
    instances.push({
      name: read.instance.name,
      revision: read.etag ?? null,
      status: read.instance.status,
      running: read.instance.status === 'Running',
      config: read.instance.config,
      devices: read.instance.devices,
      profiles: read.instance.profiles,
      createdAt: read.instance.createdAt,
      custody: custodyOf(read.instance.config, request.stack),
    });
  }
  instances.sort((left, right) => left.name.localeCompare(right.name));

  const volumes: ObservedVolume[] = (await client.listVolumes(request.pool))
    .map((volume) => ({
      name: volume.name,
      config: volume.config,
      usedBy: volume.usedBy.map(instanceOfUrl).sort(),
      custody: custodyOf(volume.config, request.stack),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const present = new Set(volumes.map((volume) => volume.name));

  const aliases = Object.fromEntries(
    (await client.listImageAliases())
      .map((alias) => [alias.name, alias.target] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  );

  const files: ObservedFile[] = [];
  for (const file of request.files) {
    if (!present.has(file.volume)) continue;
    const target = volumeTarget(request.pool, file.volume);
    const candidates: { path: string; generation: number | null }[] = [];
    if (file.write === 'overwrite') {
      candidates.push({ path: `/${file.path}`, generation: null });
    } else {
      const directory = posix.dirname(`/${file.path}`);
      const base = posix.basename(file.path);
      const listing = await readFile(client, target, directory);
      if (listing?.type === 'directory')
        for (const entry of listing.entries) {
          if (!entry.startsWith(`${base}.`)) continue;
          const suffix = entry.slice(base.length + 1);
          if (!GENERATION.test(suffix)) continue;
          candidates.push({
            path: posix.join(directory, entry),
            generation: Number(suffix),
          });
        }
    }
    for (const candidate of candidates) {
      const entry = await readFile(client, target, candidate.path);
      if (entry?.type !== 'file') continue;
      files.push({
        volume: file.volume,
        path: file.path,
        generation: candidate.generation,
        sha256: request.key.digestBytes(entry.content),
        mode: octal(entry.mode),
        uid: entry.uid,
        gid: entry.gid,
      });
    }
  }
  files.sort(
    (left, right) =>
      left.volume.localeCompare(right.volume) ||
      left.path.localeCompare(right.path) ||
      (left.generation ?? -1) - (right.generation ?? -1),
  );

  const backups = present.has(BACKUPS_VOLUME);
  return {
    stack: request.stack,
    pool: request.pool,
    instances,
    volumes,
    aliases,
    files,
    record: backups
      ? await readStackRecord(client, request.pool, request.stack)
      : null,
    manifests: backups ? await holdsManifest(client, request.pool) : false,
  };
}

/** The record files of `backups`, newest generation first. */
export async function stackRecordFiles(
  client: IncusClient,
  pool: string,
): Promise<{ name: string; generation: number }[]> {
  const root = await readFile(client, volumeTarget(pool, BACKUPS_VOLUME), '/');
  if (root?.type !== 'directory') return [];
  return root.entries
    .flatMap((name) => {
      const match = RECORD_FILE.exec(name);
      return match ? [{ name, generation: Number(match[1] ?? '0') }] : [];
    })
    .sort((left, right) => right.generation - left.generation);
}

/**
 * The newest deploy record that parses and names this stack. A torn newer
 * generation (a write a crash cut short) is passed over, so the previous
 * record stays in force until its successor reads back (R3-29).
 */
export async function readStackRecord(
  client: IncusClient,
  pool: string,
  stack: string,
): Promise<StackRecord | null> {
  for (const file of await stackRecordFiles(client, pool)) {
    const entry = await readFile(
      client,
      volumeTarget(pool, BACKUPS_VOLUME),
      `/${file.name}`,
      { maxBytes: RECORD_MAX_BYTES },
    );
    if (entry?.type !== 'file') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(entry.content));
    } catch (error) {
      console.warn(
        `Skipping the deploy record ${file.name}: it is not JSON (${error instanceof Error ? error.message : String(error)}).`,
      );
      continue;
    }
    const record = stackRecordSchema.safeParse(parsed);
    if (record.success && record.data.stack === stack) return record.data;
    console.warn(`Skipping the deploy record ${file.name}: not this stack's.`);
  }
  return null;
}

/** Whether a snapshot directory in `backups` holds a manifest. */
async function holdsManifest(
  client: IncusClient,
  pool: string,
): Promise<boolean> {
  const target = volumeTarget(pool, BACKUPS_VOLUME);
  const root = await readFile(client, target, '/');
  if (root?.type !== 'directory') return false;
  let scanned = 0;
  for (const name of root.entries) {
    if (RECORD_FILE.test(name)) continue;
    if (MANIFEST_FILE.test(name)) return true;
    if (scanned >= MANIFEST_SCAN_LIMIT) break;
    scanned += 1;
    const entry = await readFile(client, target, `/${name}`);
    if (
      entry?.type === 'directory' &&
      entry.entries.some((child) => MANIFEST_FILE.test(child))
    )
      return true;
  }
  return false;
}

/** Whether the stack ran before: what may make a missing data volume a
 * restore rather than a fresh start (design D-29, R3-22). */
export function deployedBefore(readback: Readback): boolean {
  return (
    readback.record?.deployedAt !== undefined ||
    readback.manifests ||
    readback.instances.some(
      (instance) => instance.custody.verdict === 'stack',
    ) ||
    readback.volumes.some((volume) => volume.name.includes(PRE_RESTORE_MARKER))
  );
}

/** A reset recorded after the last deploy: the next deploy may make the data
 * volumes again, once. */
export function resetSinceDeploy(record: StackRecord | null): boolean {
  if (record?.resetAt === undefined) return false;
  return (
    record.deployedAt === undefined ||
    Date.parse(record.resetAt) > Date.parse(record.deployedAt)
  );
}

const STATE_WORDS: Record<string, string> = {
  Running: 'running',
  Frozen: 'paused',
  Stopped: 'exited',
  Starting: 'restarting',
  Stopping: 'restarting',
  Error: 'dead',
};

function mountsOf(devices: Devices): InstanceMount[] {
  return Object.values(devices)
    .filter((device) => device.type === 'disk' && device.path !== '/')
    .map((device) => ({
      kind: 'volume' as const,
      source: device.source ?? '',
      target: device.path ?? '',
      readOnly: device.readonly === 'true',
    }))
    .sort((left, right) => left.target.localeCompare(right.target));
}

function environmentOf(
  config: Readonly<Record<string, string>>,
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(config))
    if (key.startsWith('environment.'))
      environment[key.slice('environment.'.length)] = value;
  return environment;
}

/**
 * The runtime's readback of one instance (`InstanceInfo`): labels, state,
 * mounts and address, the allow-listed environment keys and a keyed digest
 * of the whole environment. No other environment value leaves this function.
 */
export function instanceInfo(
  instance: ObservedInstance,
  key: PlanKey,
): InstanceInfo {
  const { config } = instance;
  const environment = environmentOf(config);
  const nic = Object.values(instance.devices).find(
    (device) => device.type === 'nic',
  );
  const colour = config['user.tale.colour'];
  const index = Number(config['user.tale.index'] ?? '1');
  return {
    stack: config[STACK_LABEL] ?? '',
    service: config['user.tale.service'] ?? instance.name,
    index: Number.isSafeInteger(index) && index > 0 ? index : 1,
    ...(colour === 'blue' || colour === 'green' ? { colour } : {}),
    oneOff: config['user.tale.role'] === 'helper',
    name: instance.name,
    running: instance.running,
    state: STATE_WORDS[instance.status] ?? instance.status.toLowerCase(),
    startedAt: null,
    restarted: false,
    image: {
      reference: config['user.tale.image'] ?? '',
      digest: config['user.tale.image'] ?? null,
      version: config['user.tale.version'] ?? null,
      revision: config['user.tale.revision'] ?? null,
      automationWriterProtocol: null,
    },
    environment: pickInstanceEnvironment(environment),
    environmentDigest: key.digest(environment),
    mounts: mountsOf(instance.devices),
    address: nic?.['ipv4.address']?.split('/')[0] ?? null,
    configDigest: config['user.tale.config'] ?? null,
  };
}

/** The stack's own instances as `InstanceInfo`. */
export function stackInstances(
  readback: Readback,
  key: PlanKey,
): InstanceInfo[] {
  return readback.instances
    .filter((instance) => instance.custody.verdict === 'stack')
    .map((instance) => instanceInfo(instance, key));
}

/**
 * Refuse to act on an instance or a volume that is not the stack's: one
 * labelled for another stack, or one without a label that happens to carry
 * a name the stack needs. The CLI never adopts either.
 */
export function assertCustody(
  kind: 'instance' | 'volume',
  name: string,
  custody: Custody,
  stack: string,
): void {
  if (custody.verdict === 'stack') return;
  const what = kind === 'instance' ? 'Instance' : 'Volume';
  throw preconditionError(
    custody.verdict === 'foreign'
      ? `${what} ${name} belongs to the stack ${custody.stack}, not ${stack}; the CLI does not touch it.`
      : `${what} ${name} exists without a stack label; the CLI does not adopt it.`,
    `Remove or rename ${name} in the Incus project, or deploy into a project of its own.`,
  );
}
