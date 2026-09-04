/**
 * Whether a SUBSCRIPTION-lane agent turn can see images, and what to do when
 * it cannot. The gateway lane arms a vision polyfill for a text-only model;
 * the subscription lane mints no gateway key, so images reach the model only
 * if the vendor endpoint the subscription rides FORWARDS image blocks (the
 * provider's declared `imageInputs`) AND the model reads them
 * (`supportsVision`). Z.ai's Anthropic-compatible coding door drops every
 * image block with a 200 — a vision-capable GLM answers blind — so a static
 * per-model flag was guarding the wrong fact; the capability is a property of
 * the resolved serving pathway.
 *
 * Pure: the serving resolver computes the fact, the hosts act on it — a turn
 * whose staged inputs include image files is REFUSED with the actionable
 * reason (the run fails visibly instead of hallucinating what it never saw);
 * any other turn carries explicit guidance so the agent reports an image it
 * could not read rather than inferring its contents.
 */

import type {
  ModelCatalogEntry,
  ProviderDefinition,
} from '../../../../lib/shared/schemas/providers';

export type SubscriptionVision =
  | { readable: true }
  | { readable: false; reason: string };

/** The vision fact for one (provider auth entry, catalog model) serving. */
export function subscriptionVisionCapability(
  provider: ProviderDefinition,
  authMethod: 'subscription-key' | 'subscription-broker',
  entry: Pick<ModelCatalogEntry, 'id' | 'supportsVision'>,
): SubscriptionVision {
  const authEntry = provider.auth.find(
    (candidate) => candidate.method === authMethod,
  );
  if (
    authEntry !== undefined &&
    authEntry.method === authMethod &&
    authEntry.imageInputs === 'dropped'
  ) {
    return {
      readable: false,
      reason: `the "${provider.name}" ${authMethod} endpoint silently drops image inputs — every model answers blind to images on this lane`,
    };
  }
  if (!entry.supportsVision) {
    return {
      readable: false,
      reason: `model "${entry.id}" is text-only and the subscription lane has no vision polyfill — image inputs fail on this lane`,
    };
  }
  return { readable: true };
}

/** Raster image formats an agent harness would hand the model as image
 * blocks. SVG is text and stays readable as such. */
const IMAGE_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'tif',
  'tiff',
  'heic',
  'heif',
  'avif',
]);

/** True when a staged input's name says it is a raster image. */
export function isImageFileName(fileName: string): boolean {
  const dot = fileName.lastIndexOf('.');
  if (dot === -1 || dot === fileName.length - 1) return false;
  return IMAGE_FILE_EXTENSIONS.has(fileName.slice(dot + 1).toLowerCase());
}

/** The image files among a turn's staged inputs (names or paths). */
export function unreadableImageInputs(fileNames: readonly string[]): string[] {
  return fileNames.filter(isImageFileName);
}

/**
 * Refuse a turn whose inputs the serving cannot see. Throws the actionable
 * reason — the hosts' start-failed path posts it on the run, so the user
 * learns WHY and what to change instead of receiving confident output about
 * images the model never received.
 */
export function refuseBlindImageTurn(
  vision: SubscriptionVision,
  stagedFileNames: readonly string[],
): void {
  if (vision.readable) return;
  const images = unreadableImageInputs(stagedFileNames);
  if (images.length === 0) return;
  throw new Error(
    `this turn's inputs include image files (${images.join(', ')}) that the serving model cannot see: ${vision.reason}. Pin the agent to a directly-served (api-key/env) model, or make such a credential the provider's default, so images are read.`,
  );
}

/** The instructions block a blind subscription turn carries when no staged
 * input is an image: the agent may still meet one (a browser screenshot, a
 * file it produces) and must say so rather than invent its contents. */
export function visionUnreadableGuidance(vision: SubscriptionVision): string {
  if (vision.readable) return '';
  return [
    `Image inputs are NOT visible to you on this run's serving lane: ${vision.reason}.`,
    'Any image file or screenshot you open arrives blank or unreadable. Never infer, guess, or reconstruct the contents of an image; instead, name the file you could not read and say that image reading is unavailable on this run, so a person can re-run it on a vision-capable serving.',
  ].join(' ');
}
