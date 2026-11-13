import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { IncusClient } from '@tale/incus/client';
import { z } from 'zod';

import { preconditionError } from '../../../../utils/fail';
import {
  mirrorOf,
  parseImageReference,
  type RegistryMirrors,
} from '../../../oci/registry';
import { boundedJson, writePrivateJson } from '../../../state/private-files';
import type { StackImage } from '../compile/stack-target';
import { imageAlias } from '../compile/translate';
import { incusStateDirectory } from '../plan/digest';

/**
 * The stack's images in its Incus project (design 4.1 `ensureImages`).
 *
 * Incus pulls an OCI image by digest into the project under the alias
 * `tale-<repository>-<32 hex of the digest>` — never by tag, so what runs is
 * exactly what the plan names, and a second pull of the same digest is a
 * no-op. Incus has no tags: a stack instance names its image by that alias.
 * The sandbox runtime and BuildKit images are not the stack's; the spawner
 * pulls its own into the sandbox project.
 *
 * `pruneImages` keeps, per repository, the image the target runs and the one
 * pulled before it (a rollback's), plus any an instance still uses; the order
 * of pulls lives in `<state>/.tale/incus/images.json`.
 */

/** The pull order kept beside the image facts. */
const IMAGE_HISTORY_FILE = 'images.json';
const PULL_WAIT_MS = 30 * 60_000;
const DELETE_WAIT_MS = 120_000;
/** A stack image alias: the repository part, then 32 hex of the digest. */
const STACK_ALIAS = /^(tale-[a-z0-9._-]+)-([0-9a-f]{32})$/;

const historySchema = z.strictObject({
  schemaVersion: z.literal(1),
  /** Repository part of the alias → its aliases, oldest pull first. */
  repositories: z.record(z.string(), z.array(z.string()).max(64)),
});
type ImageHistory = z.infer<typeof historySchema>;

/** The hosts that stand in for registries: `runtime.incus.registryMirror`
 * for docker.io, `runtime.incus.registryMirrors` for the others. */
export interface ImagePullOptions extends RegistryMirrors {
  stateRoot: string;
  waitMs?: number;
}

export interface EnsuredImages {
  /** Aliases pulled by this call. */
  pulled: string[];
  /** Aliases the project held already. */
  kept: string[];
  /** Images that could not be pulled, with Incus's words. */
  failed: { reference: string; detail: string }[];
}

/** Where Incus pulls `reference` from: the registry host exactly as the
 * remote URL carries it (the host `restricted.images.servers` must list),
 * and the repository and digest it asks that registry for. */
export function pullSource(
  reference: string,
  mirrors: RegistryMirrors = {},
): { host: string; server: string; alias: string } {
  const parsed = parseImageReference(reference);
  if (parsed.digest === null)
    throw preconditionError(
      `Image ${reference} names no digest; Incus pulls a stack image by digest only.`,
    );
  const host = mirrorOf(parsed.registry, mirrors) ?? parsed.registry;
  return {
    host,
    server: `https://${host}`,
    alias: `${parsed.repository}@${parsed.digest}`,
  };
}

/** The registry hosts a set of images is pulled from. */
export function registryHosts(
  images: readonly Pick<StackImage, 'reference'>[],
  mirrors: RegistryMirrors = {},
): string[] {
  return [
    ...new Set(
      images.map((image) => pullSource(image.reference, mirrors).host),
    ),
  ].sort();
}

function historyFile(stateRoot: string): string {
  return join(incusStateDirectory(stateRoot), IMAGE_HISTORY_FILE);
}

async function readHistory(stateRoot: string): Promise<ImageHistory> {
  const file = historyFile(stateRoot);
  try {
    return historySchema.parse(await boundedJson(file));
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      console.warn(
        `The image pull order in ${file} is unreadable; starting it again:`,
        error instanceof Error ? error.message : error,
      );
    return { schemaVersion: 1, repositories: {} };
  }
}

async function writeHistory(
  stateRoot: string,
  history: ImageHistory,
): Promise<void> {
  await mkdir(incusStateDirectory(stateRoot), {
    recursive: true,
    mode: 0o700,
  });
  await writePrivateJson(historyFile(stateRoot), history);
}

/** The repository part of a stack alias; null for another alias. */
function repositoryOf(alias: string): string | null {
  return STACK_ALIAS.exec(alias)?.[1] ?? null;
}

/** Refuse an image whose alias is not the one its reference and digest
 * make: an alias names exactly one digest. */
function checkImage(image: StackImage): void {
  const expected = imageAlias({
    reference: image.reference,
    digest: image.digest,
  });
  if (image.alias !== expected || !image.reference.endsWith(`@${image.digest}`))
    throw preconditionError(
      `Image ${image.reference} is planned under the alias ${image.alias}, not ${expected}.`,
    );
}

/** Pull every image the project does not hold yet, by digest under its
 * alias; one already there is kept. A failed pull does not stop the others:
 * every failure comes back together. */
export async function ensureImages(
  client: IncusClient,
  images: readonly StackImage[],
  options: ImagePullOptions,
): Promise<EnsuredImages> {
  for (const image of images) checkImage(image);
  const result: EnsuredImages = { pulled: [], kept: [], failed: [] };
  const failed = new Set<string>();
  await Promise.all(
    images.map(async (image) => {
      if ((await client.getImageAlias(image.alias)) !== undefined) {
        result.kept.push(image.alias);
        return;
      }
      const source = pullSource(image.reference, options);
      try {
        await client.pullOciImage(
          { server: source.server, alias: source.alias },
          image.alias,
          options.waitMs ?? PULL_WAIT_MS,
        );
      } catch (error) {
        // Another run may have pulled it meanwhile; the alias decides.
        if ((await client.getImageAlias(image.alias)) !== undefined) {
          result.kept.push(image.alias);
          return;
        }
        failed.add(image.alias);
        result.failed.push({
          reference: image.reference,
          detail: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      if ((await client.getImageAlias(image.alias)) === undefined) {
        failed.add(image.alias);
        result.failed.push({
          reference: image.reference,
          detail: `the pull ended, but the project holds no alias ${image.alias}`,
        });
        return;
      }
      result.pulled.push(image.alias);
    }),
  );
  const history = await readHistory(options.stateRoot);
  for (const image of images) {
    const repository = repositoryOf(image.alias);
    if (repository === null || failed.has(image.alias)) continue;
    const order = (history.repositories[repository] ?? []).filter(
      (alias) => alias !== image.alias,
    );
    history.repositories[repository] = [...order, image.alias].slice(-64);
  }
  await writeHistory(options.stateRoot, history);
  result.pulled.sort();
  result.kept.sort();
  result.failed.sort((left, right) =>
    left.reference.localeCompare(right.reference),
  );
  return result;
}

/** The refusal for pulls that failed. */
export function pullFailure(failed: EnsuredImages['failed']) {
  return preconditionError(
    `Incus could not pull ${failed.length} image(s):\n${failed.map((item) => `${item.reference}: ${item.detail}`).join('\n')}`,
    'Check that the project lets the stack pull from each registry (restricted.images.servers) and that the image exists for the server architecture.',
  );
}

/**
 * Delete the stack's images no longer needed: per repository of `current`,
 * every alias but the current one, the one pulled before it, and any an
 * instance of the project still runs. An image goes with its last alias.
 * Returns the aliases deleted.
 */
export async function pruneImages(
  client: IncusClient,
  current: readonly string[],
  options: Pick<ImagePullOptions, 'stateRoot'>,
): Promise<string[]> {
  const repositories = new Map<string, string>();
  for (const alias of current) {
    const repository = repositoryOf(alias);
    if (repository !== null) repositories.set(repository, alias);
  }
  const history = await readHistory(options.stateRoot);
  const keep = new Set(current);
  for (const [repository, alias] of repositories) {
    const order = history.repositories[repository] ?? [];
    const before = order.slice(0, Math.max(order.indexOf(alias), 0));
    const previous = before.at(-1);
    if (previous !== undefined) keep.add(previous);
  }
  const used = new Set<string>();
  const usedDigests = new Set<string>();
  for (const instance of await client.listInstances()) {
    const base = instance.config['volatile.base_image'];
    if (base !== undefined) used.add(base);
    const digest = instance.config['user.tale.image'];
    if (digest !== undefined)
      usedDigests.add(digest.replace(/^sha256:/, '').slice(0, 32));
  }
  const aliases = await client.listImageAliases();
  const deleted: string[] = [];
  for (const alias of aliases) {
    const match = STACK_ALIAS.exec(alias.name);
    if (match === null || !repositories.has(match[1] ?? '')) continue;
    if (
      keep.has(alias.name) ||
      used.has(alias.target) ||
      usedDigests.has(match[2] ?? '')
    )
      continue;
    await client.deleteImageAlias(alias.name);
    deleted.push(alias.name);
    const stillNamed = aliases.some(
      (other) => other.target === alias.target && !deleted.includes(other.name),
    );
    if (!stillNamed) await client.deleteImage(alias.target, DELETE_WAIT_MS);
  }
  for (const [repository, order] of Object.entries(history.repositories))
    history.repositories[repository] = order.filter(
      (alias) => !deleted.includes(alias),
    );
  await writeHistory(options.stateRoot, history);
  return deleted.sort();
}
