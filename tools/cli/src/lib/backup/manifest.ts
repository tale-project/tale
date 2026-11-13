import { z } from 'zod';

import * as logger from '../../utils/logger';
import { isValidSnapshotId } from './constants';

/**
 * The snapshot manifest: what one snapshot holds, read by `tale restore`,
 * `rotate` and `verify`.
 *
 * - **v1** (Docker, and every manifest written before native snapshots): no
 *   `schemaVersion`; each volume is a tar.gz archive with its `sha256` and
 *   `sizeBytes`. Docker keeps writing v1, as `<id>/manifest.json`.
 * - **v2** (Incus, design D-28): `schemaVersion: 2`, the runtime, the freeze
 *   window the set was taken in, and per volume an optional `native`
 *   snapshot. The archive fields are optional only where `native` is
 *   present: a volume is always recoverable from one or the other. After a
 *   restore aside, `native.volume` names the holder the snapshot moved with
 *   (`<v>.pre-restore-<ts>`, R-06).
 *
 * On Incus a manifest is never overwritten (R3-29): each write is a new
 * generation `<id>/manifest.<gen>.json`, the previous one is deleted only
 * after the new one reads back, and a reader takes the newest generation that
 * parses and names its own snapshot (`newestManifest`).
 */

export const SNAPSHOT_TRIGGERS = [
  'deploy',
  'start',
  'update',
  'manual',
] as const;
export type SnapshotTrigger = (typeof SNAPSHOT_TRIGGERS)[number];

/** An Incus volume name (the holder of a restore aside included). */
const VOLUME_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const SHA256 = /^[0-9a-f]{64}$/;

/** The native snapshot of one volume a set took: `tale-<id>`. */
export function nativeSnapshotName(id: string): string {
  if (!isValidSnapshotId(id)) throw new Error(`Invalid snapshot id: ${id}`);
  return `tale-${id}`;
}

const nativeSchema = z.strictObject({
  /** `tale-<id>`. */
  snapshot: z.string().regex(/^tale-[0-9]{8}-[0-9]{6}-[a-z]+$/),
  /** When Incus says it took it (the server's clock). */
  createdAt: z.string().datetime({ offset: true }),
  /** The volume that holds it when a restore moved it aside; absent, the
   * volume it was taken of. */
  volume: z.string().regex(VOLUME_NAME).optional(),
  /** The bytes the volume used when it was taken: the pool space a copy of
   * it needs. */
  usedBytes: z.number().int().nonnegative(),
  /** The volume's `size`, which a copy counts against the project's pool
   * quota; 0 for a volume without one. */
  quotaBytes: z.number().int().nonnegative(),
});

const volumeSchema = z
  .strictObject({
    /** The archive `<volume>.tar.gz`'s sha256 and size. */
    sha256: z.string().regex(SHA256).optional(),
    sizeBytes: z.number().int().nonnegative().optional(),
    native: nativeSchema.optional(),
  })
  .refine(
    (volume) =>
      (volume.sha256 === undefined) === (volume.sizeBytes === undefined),
    { message: 'an archive needs both its sha256 and its size' },
  )
  .refine(
    (volume) => volume.sha256 !== undefined || volume.native !== undefined,
    { message: 'a volume needs an archive or a native snapshot' },
  );
export type SnapshotVolumeInfo = z.infer<typeof volumeSchema>;

const common = {
  id: z.string().refine(isValidSnapshotId, 'not a snapshot id'),
  createdAt: z.string(),
  cliVersion: z.string(),
  platformVersion: z.string().nullable(),
  trigger: z.enum(SNAPSHOT_TRIGGERS),
};

const v1Schema = z.object({
  ...common,
  volumes: z.record(
    z.string(),
    z.object({
      sha256: z.string(),
      sizeBytes: z.number(),
    }),
  ),
});

const v2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  ...common,
  runtime: z.enum(['docker', 'incus']),
  /** The CLI's clock around the freeze: the set's snapshots were all taken
   * within it, so their spread is at most its length. */
  freeze: z
    .strictObject({
      startedAt: z.string().datetime({ offset: true }),
      endedAt: z.string().datetime({ offset: true }),
    })
    .optional(),
  volumes: z.record(z.string().regex(VOLUME_NAME), volumeSchema),
});

export interface SnapshotManifest {
  /** 2 for a manifest with native snapshots; absent for v1. */
  schemaVersion?: 2;
  id: string;
  createdAt: string;
  cliVersion: string;
  platformVersion: string | null;
  trigger: SnapshotTrigger;
  runtime?: 'docker' | 'incus';
  freeze?: { startedAt: string; endedAt: string };
  volumes: Record<string, SnapshotVolumeInfo>;
}

/** The manifest's shape checked, or why not: v2 by its schema, else v1. */
export function checkManifest(
  value: unknown,
): { manifest: SnapshotManifest } | { problem: string } {
  const isV2 =
    typeof value === 'object' &&
    value !== null &&
    'schemaVersion' in value &&
    value.schemaVersion !== undefined;
  if (isV2) {
    const parsed = v2Schema.safeParse(value);
    if (!parsed.success)
      return { problem: parsed.error.issues[0]?.message ?? 'invalid' };
    return { manifest: parsed.data };
  }
  const parsed = v1Schema.safeParse(value);
  if (!parsed.success)
    return { problem: parsed.error.issues[0]?.message ?? 'invalid' };
  return {
    manifest: {
      id: parsed.data.id,
      createdAt: parsed.data.createdAt,
      cliVersion: parsed.data.cliVersion,
      platformVersion: parsed.data.platformVersion ?? null,
      trigger: parsed.data.trigger,
      volumes: parsed.data.volumes,
    },
  };
}

/**
 * One manifest from its text, or null (with a warning) where it is no JSON
 * or not a manifest this CLI reads.
 */
export function parseManifest(raw: string): SnapshotManifest | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (err) {
    logger.warn(
      `Skipping unparseable snapshot manifest: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
  const checked = checkManifest(value);
  if ('problem' in checked) {
    logger.warn(
      `Skipping snapshot manifest with invalid shape (${checked.problem}): ${raw}`,
    );
    return null;
  }
  return checked.manifest;
}

/** `manifest.<gen>.json` (Incus), or v1's `manifest.json` (generation 0). */
const MANIFEST_FILE = /^manifest(?:\.(\d{1,12}))?\.json$/;

/** The generation a manifest file name carries; null for another file. */
export function manifestGeneration(file: string): number | null {
  const match = MANIFEST_FILE.exec(file);
  return match === null ? null : Number(match[1] ?? '0');
}

/** The file name of generation `generation`. */
export function manifestFile(generation: number): string {
  if (!Number.isSafeInteger(generation) || generation < 1)
    throw new Error(`Not a manifest generation: ${generation}`);
  return `manifest.${generation}.json`;
}

/**
 * The newest generation of one snapshot's manifest that parses and names
 * that snapshot, with its generation (R3-29). A torn newer generation (a
 * write a crash cut short) is passed over, so the generation before it stays
 * in force.
 */
export function newestManifest(
  id: string,
  generations: readonly { generation: number; text: string | null }[],
): { manifest: SnapshotManifest; generation: number } | null {
  const newestFirst = [...generations].sort(
    (left, right) => right.generation - left.generation,
  );
  for (const { generation, text } of newestFirst) {
    if (text === null) continue;
    const manifest = parseManifest(text);
    if (manifest === null) continue;
    if (manifest.id !== id) {
      logger.warn(
        `Skipping generation ${generation} of snapshot ${id}'s manifest: it names snapshot ${manifest.id}.`,
      );
      continue;
    }
    return { manifest, generation };
  }
  return null;
}

/** The bytes a manifest is written as: one line of JSON (list output). */
export function manifestBytes(manifest: SnapshotManifest): Uint8Array {
  const checked = checkManifest(manifest);
  if ('problem' in checked)
    throw new Error(
      `Refusing to write an invalid snapshot manifest for ${manifest.id}: ${checked.problem}`,
    );
  return new TextEncoder().encode(JSON.stringify(manifest));
}

/** Where a volume's native snapshot lives now. */
export function nativeSource(
  volume: string,
  info: SnapshotVolumeInfo,
): { volume: string; snapshot: string } | null {
  if (info.native === undefined) return null;
  return {
    volume: info.native.volume ?? volume,
    snapshot: info.native.snapshot,
  };
}

/** Whether the volume has a tar.gz archive in the snapshot directory. */
export function hasArchive(info: SnapshotVolumeInfo): boolean {
  return info.sha256 !== undefined && info.sizeBytes !== undefined;
}

/** The bytes a snapshot takes: its archives, else its volumes' data. */
export function manifestSizeBytes(manifest: SnapshotManifest): number {
  return Object.values(manifest.volumes).reduce(
    (sum, info) => sum + (info.sizeBytes ?? info.native?.usedBytes ?? 0),
    0,
  );
}
