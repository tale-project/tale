import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join, posix } from 'node:path';

import type { IncusClient } from '@tale/incus/client';
import { readFile, statFile, type IncusFileStat } from '@tale/incus/files';
import { z } from 'zod';

import { boundedJson, writePrivateJson } from '../../../state/private-files';
import { incusStateDirectory } from '../plan/digest';
import { STACK_PROFILE } from './probe';

/**
 * What only an image's filesystem says, read once per image digest (design
 * D-27, R3-23, R3-26, R3-30): the owner and mode of each path a stack volume
 * mounts at, the uid and gid of the image's app user, whether `timeout` is
 * on the image's PATH, and the file formats the image's infrastructure
 * role reads (`dev.tale.infra-formats`).
 *
 * Incus shows no image filesystem; an instance's file API does, running or
 * not. So the facts come from a stopped probe instance made from the image
 * for the purpose and deleted after — no process of the image ever runs.
 * They are kept in `<state>/.tale/incus/image-facts.json` by digest: an
 * image's bytes never change under its digest, so a fact read once holds.
 * The managed path's CLI and its release pins can differ, which is why the
 * owners are read and never tabled.
 */

/** The file the facts are kept in, under the Incus state directory. */
export const IMAGE_FACTS_FILE = 'image-facts.json';
/** The account the platform image's processes run as (`withdraw` execs as
 * it, R3-26). */
const APP_USER = 'app';
/** The PATH Docker gives an image that declares none. */
const DEFAULT_PATH =
  '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
const INFRA_FORMATS_LABEL = 'dev.tale.infra-formats';
const PASSWD_MAX_BYTES = 256 * 1024;
const PROBE_WAIT_MS = 120_000;

const ownerSchema = z.strictObject({
  type: z.enum(['file', 'directory', 'symlink']),
  uid: z.number().int().nonnegative(),
  gid: z.number().int().nonnegative(),
  mode: z.string().regex(/^0?[0-7]{3,4}$/),
});
export type PathOwner = z.infer<typeof ownerSchema>;

const recordSchema = z.strictObject({
  digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  /** Each path asked about: its owner, or null where the image lacks it. */
  paths: z.record(z.string(), ownerSchema.nullable()),
  appUser: z
    .strictObject({
      uid: z.number().int().nonnegative(),
      gid: z.number().int().nonnegative(),
    })
    .nullable(),
  /** The absolute path of `timeout` on the image's PATH; null without one. */
  timeout: z.string().nullable(),
  infraFormats: z.array(z.string()),
  readAt: z.string().datetime(),
});
export type ImageFsFacts = z.infer<typeof recordSchema>;

const fileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  images: z.record(z.string(), recordSchema),
});
type FactsFile = z.infer<typeof fileSchema>;

/** One image, as the facts reader needs it. */
export interface FactsRequest {
  /** The image alias in the project. */
  alias: string;
  digest: string;
  /** The image's `PATH=` entries and labels, from its registry config. */
  env: readonly string[];
  labels: Readonly<Record<string, string>>;
  /** The absolute paths whose owner is asked for (volume mount points). */
  paths: readonly string[];
}

export interface FactsOptions {
  stateRoot: string;
  /** `user.tale.stack` of the probe instance, for custody and reaping. */
  stack: string;
  now?: () => Date;
}

function factsFile(stateRoot: string): string {
  return join(incusStateDirectory(stateRoot), IMAGE_FACTS_FILE);
}

/** The cache as it is on disk; an unreadable cache is read as empty (every
 * fact is read again), with a warning. */
async function readCache(stateRoot: string): Promise<FactsFile> {
  const file = factsFile(stateRoot);
  try {
    return fileSchema.parse(await boundedJson(file));
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      console.warn(
        `The image facts in ${file} are unreadable; reading them again:`,
        error instanceof Error ? error.message : error,
      );
    return { schemaVersion: 1, images: {} };
  }
}

async function writeCache(stateRoot: string, cache: FactsFile): Promise<void> {
  await mkdir(incusStateDirectory(stateRoot), {
    recursive: true,
    mode: 0o700,
  });
  await writePrivateJson(factsFile(stateRoot), fileSchema.parse(cache));
}

/** The facts cached for one image digest; null where none were read yet
 * (an exec then assumes no `timeout`, design R3-30). */
export async function cachedImageFacts(
  stateRoot: string,
  digest: string,
): Promise<ImageFsFacts | null> {
  return (await readCache(stateRoot)).images[digest] ?? null;
}

/** The uid and gid of `user` in an `/etc/passwd`; null without the user. */
export function passwdUser(
  passwd: string,
  user: string,
): { uid: number; gid: number } | null {
  for (const line of passwd.split('\n')) {
    const fields = line.split(':');
    if (fields[0] !== user || fields.length < 4) continue;
    const uid = Number(fields[2]);
    const gid = Number(fields[3]);
    if (Number.isSafeInteger(uid) && Number.isSafeInteger(gid))
      return { uid, gid };
  }
  return null;
}

/** The directories of the image's PATH, in order. */
export function pathDirectories(env: readonly string[]): string[] {
  const entry = env.find((item) => item.startsWith('PATH='));
  const value = entry === undefined ? DEFAULT_PATH : entry.slice(5);
  return value
    .split(':')
    .filter((directory) => directory.startsWith('/'))
    .map((directory) => posix.normalize(directory).replace(/(.)\/+$/, '$1'));
}

/** The formats a `dev.tale.infra-formats` label names. */
export function infraFormatsOf(labels: Readonly<Record<string, string>>) {
  return (labels[INFRA_FORMATS_LABEL] ?? '')
    .split(/[\s,]+/)
    .filter((item) => item !== '');
}

function ownerOf(stat: IncusFileStat): PathOwner {
  return { type: stat.type, uid: stat.uid, gid: stat.gid, mode: stat.mode };
}

/** A probe instance's name: valid for Incus, never a stack service's. */
function probeName(digest: string): string {
  return `tale-probe-${digest.replace(/^sha256:/, '').slice(0, 12)}-${randomBytes(3).toString('hex')}`;
}

/** Read the facts of one image through a stopped probe instance. */
async function readThroughProbe(
  client: IncusClient,
  request: FactsRequest,
  paths: readonly string[],
  options: FactsOptions,
): Promise<Omit<ImageFsFacts, 'readAt' | 'digest' | 'infraFormats'>> {
  const name = probeName(request.digest);
  await client.createInstance(
    {
      name,
      ephemeral: false,
      profiles: [STACK_PROFILE],
      config: {
        'security.idmap.isolated': 'true',
        'user.tale.stack': options.stack,
        'user.tale.role': 'probe',
      },
      devices: {},
      source: { type: 'image', alias: request.alias },
      start: false,
    },
    PROBE_WAIT_MS,
  );
  try {
    const target = { instance: name };
    const owners: Record<string, PathOwner | null> = {};
    for (const path of paths) {
      const stat = await statFile(client, target, path);
      owners[path] = stat === undefined ? null : ownerOf(stat);
    }
    const passwd = await readFile(client, target, '/etc/passwd', {
      maxBytes: PASSWD_MAX_BYTES,
    });
    const appUser =
      passwd?.type === 'file'
        ? passwdUser(new TextDecoder().decode(passwd.content), APP_USER)
        : null;
    let timeout: string | null = null;
    for (const directory of pathDirectories(request.env)) {
      const candidate = posix.join(directory, 'timeout');
      const stat = await statFile(client, target, candidate);
      if (stat !== undefined && stat.type !== 'directory') {
        timeout = candidate;
        break;
      }
    }
    return { paths: owners, appUser, timeout };
  } finally {
    await client.deleteInstance(name, PROBE_WAIT_MS).catch((error: unknown) => {
      console.warn(
        `The probe instance ${name} could not be deleted; the next run reaps it:`,
        error instanceof Error ? error.message : error,
      );
    });
  }
}

/** Delete probe instances an interrupted read left behind in the stack. */
export async function reapProbes(
  client: IncusClient,
  stack: string,
): Promise<string[]> {
  const reaped: string[] = [];
  for (const instance of await client.listInstances()) {
    if (
      instance.config['user.tale.role'] !== 'probe' ||
      instance.config['user.tale.stack'] !== stack ||
      instance.status !== 'Stopped'
    )
      continue;
    if (await client.deleteInstance(instance.name, PROBE_WAIT_MS))
      reaped.push(instance.name);
  }
  return reaped;
}

/**
 * The facts of each image, from the cache where it holds every path asked
 * about, else read through a probe instance (one per image) and cached.
 * The image must be in the project under its alias already.
 */
export async function imageFsFacts(
  client: IncusClient,
  requests: readonly FactsRequest[],
  options: FactsOptions,
): Promise<Map<string, ImageFsFacts>> {
  const cache = await readCache(options.stateRoot);
  const result = new Map<string, ImageFsFacts>();
  let changed = false;
  for (const request of requests) {
    const cached = cache.images[request.digest];
    const missing = request.paths.filter(
      (path) => cached === undefined || !(path in cached.paths),
    );
    if (cached !== undefined && missing.length === 0) {
      result.set(request.digest, cached);
      continue;
    }
    const read = await readThroughProbe(
      client,
      request,
      cached === undefined ? request.paths : missing,
      options,
    );
    const facts: ImageFsFacts = {
      digest: request.digest,
      paths: { ...cached?.paths, ...read.paths },
      appUser: read.appUser,
      timeout: read.timeout,
      infraFormats: infraFormatsOf(request.labels),
      readAt: (options.now?.() ?? new Date()).toISOString(),
    };
    cache.images[request.digest] = facts;
    result.set(request.digest, facts);
    changed = true;
  }
  if (changed) await writeCache(options.stateRoot, cache);
  return result;
}
