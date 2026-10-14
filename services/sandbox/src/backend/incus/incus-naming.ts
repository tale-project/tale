// Names and labels of the Incus backend. As on the other backends, the
// objects in Incus are the source of truth and the registry only a cache:
// a session's identity, owner, creation stamp and pin live in `user.*` config
// keys of its instance (and the owner in its workspace volume's), so any
// spawner can adopt what another left.
//
// Instance names are deterministic — an Incus instance name allows neither the
// underscores a session id may hold nor its length — so a replica can address
// a session without asking. The exception is an instance claimed from the
// warm pool: Incus cannot rename a running instance, so it keeps the name it
// was made with and is found by its `user.tale.session` label.

import { createHash } from 'node:crypto';

import { belongsToInstance } from '../../session/session-naming.ts';
import type { IncusConfigMap } from './incus-api.ts';

const INSTANCE_PREFIX = 'tale-sbx-ses-';
const POOL_PREFIX = 'tale-sbx-pool-';
const VOLUME_PREFIX = 'tale-ses-ws-';
const WARMUP_PREFIX = 'tale-sbx-warm-';
/** 96 bits of the id's hash: names cannot collide in practice. */
const HASH_LENGTH = 24;

function digest(sessionId: string): string {
  return createHash('sha256')
    .update(sessionId)
    .digest('hex')
    .slice(0, HASH_LENGTH);
}

/** The instance of a session created cold. */
export function incusInstanceName(sessionId: string): string {
  return `${INSTANCE_PREFIX}${digest(sessionId)}`;
}

/** A standby instance of the warm pool; `suffix` is random hex. */
export function incusPoolInstanceName(suffix: string): string {
  return `${POOL_PREFIX}${suffix}`;
}

/** The throwaway instance that makes Incus unpack the runtime image into
 * the pool before the first session needs it; `suffix` is random hex. */
export function incusWarmupInstanceName(suffix: string): string {
  return `${WARMUP_PREFIX}${suffix}`;
}

/** Is this a warm-up instance (which may be debris of a crashed warm-up)? */
export function isWarmupInstanceName(name: string): boolean {
  return name.startsWith(WARMUP_PREFIX);
}

/** The custom volume holding a session's /agent. */
export function incusWorkspaceVolumeName(sessionId: string): string {
  return `${VOLUME_PREFIX}${digest(sessionId)}`;
}

/** The `user.*` config keys the backend writes. */
export const LABEL = {
  /** Set to `1` on every session instance. */
  sandboxSession: 'user.tale.sandbox-session',
  session: 'user.tale.session',
  organization: 'user.tale.org',
  profile: 'user.tale.profile',
  docker: 'user.tale.docker',
  /** The creation stamp the platform echoes: the incarnation. */
  created: 'user.tale.created',
  /** A random id of one create attempt: the only thing a failed create may
   * remove. */
  createAttempt: 'user.tale.create-attempt',
  egress: 'user.tale.egress-ip',
  /** The spawner instance (SANDBOX_INSTANCE) that owns the object. */
  spawnerInstance: 'user.tale.sandbox-instance',
  pinned: 'user.tale.pinned',
  startupDeadline: 'user.tale.startup-deadline',
  /** Written by the create once runnerd answers: from then on nobody is
   * creating the instance, and a stopped one has ended. Epoch ms. */
  ready: 'user.tale.ready',
  /** Set to `1` on every workspace volume. */
  workspace: 'user.tale.sandbox-workspace',
  /** On a standby instance: the fingerprint of the shape it was made for. */
  pool: 'user.tale.pool',
  /** On a standby instance: the fingerprint of the image it was made from. */
  poolImage: 'user.tale.pool-image',
  /** On a standby instance: when it was made (epoch ms). */
  poolSince: 'user.tale.pool-since',
  /** On a standby instance the pool is removing: set under the instance's
   * ETag before the removal, so that a claim racing it loses. */
  poolRetired: 'user.tale.pool-retired',
} as const;

/** A label's value; an empty value reads as absent, because Incus treats
 * both an unset key and an emptied one alike. */
export function label(config: IncusConfigMap, key: string): string | undefined {
  const value = config[key];
  return value === undefined || value === '' ? undefined : value;
}

/** Is this instance a session of the spawner instance `instance`? */
export function isSessionInstance(
  config: IncusConfigMap,
  instance: string,
): boolean {
  return (
    label(config, LABEL.sandboxSession) === '1' &&
    label(config, LABEL.session) !== undefined &&
    belongsToInstance(label(config, LABEL.spawnerInstance), instance)
  );
}

/** Is this instance a standby of the warm pool of the spawner instance
 * `instance` (not claimed yet)? */
export function isPoolInstance(
  config: IncusConfigMap,
  instance: string,
): boolean {
  return (
    label(config, LABEL.pool) !== undefined &&
    label(config, LABEL.sandboxSession) !== '1' &&
    belongsToInstance(label(config, LABEL.spawnerInstance), instance)
  );
}

/**
 * Is this volume a render session's scratch: one this backend made as such,
 * recording `default` as its profile? Scratch is deleted when its session ends;
 * a workspace is the user's data. So a volume that does not say, in so many
 * words, that it is scratch is never taken for one.
 */
export function isScratchVolume(config: IncusConfigMap): boolean {
  return (
    label(config, LABEL.workspace) === '1' &&
    label(config, LABEL.profile) === 'default'
  );
}

/** The creation stamp a label holds, or undefined when it is not one. */
export function stampOf(config: IncusConfigMap): number | undefined {
  const raw = label(config, LABEL.created);
  if (raw === undefined || !/^[0-9]{1,16}$/.test(raw)) return undefined;
  return Number(raw);
}
