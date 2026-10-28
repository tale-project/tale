import {
  GENERATE_IMAGE_COUNT_MAX,
  GENERATE_IMAGE_INPUTS_MAX,
  GENERATE_IMAGE_PROMPT_MAX_CHARS,
} from '../../../lib/agent/work-tools.ts';
import type { ToolArtifact } from '../../../lib/chat/tools.ts';
import {
  generateOneImage,
  ImageProviderError,
  prepareImageRequest,
  referenceImagesRefusal,
} from '../../core/lib/providers/image_generation.ts';
import {
  isReferenceMediaType,
  RASTER_EXTENSIONS,
  readImageSize,
  sniffRasterMediaType,
  type GeneratedImage,
  type ImageSize,
  type ReferenceImage,
} from '../../core/lib/providers/image_wire.ts';
import { getOrgBlobBytes } from '../files/service.ts';
import {
  failure,
  isArgsRecord,
  stringList,
  type WorkToolScope,
} from './scope.ts';

/**
 * `generate_image` — create images with the organization's image model and
 * attach them.
 *
 * The same provider core every lane's image tool calls
 * (`core/lib/providers/image_generation.ts`): the request is built once and
 * sent once per image, concurrently, with the organization's credential —
 * which never leaves the platform. What differs per lane is where the images
 * go (here: the artifact sink) and how the spend is admitted and booked (the
 * lane's {@link WorkToolScope.image} billing), so a chat's images count
 * against the same budget caps as its replies.
 */

/** A reference image's size cap: a photo at a size an image model reads. */
const REFERENCE_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
/** All of one call's reference images together. */
const REFERENCE_IMAGES_TOTAL_MAX_BYTES = 16 * 1024 * 1024;

interface ImageArgs {
  prompt: string;
  size: ImageSize;
  count: number;
  inputImages: string[];
}

function readArgs(input: unknown): ImageArgs | { error: string } {
  if (!isArgsRecord(input)) {
    return { error: 'generate_image takes {"prompt": "<what to draw>"}.' };
  }
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (prompt === '') {
    return { error: '"prompt" must describe the image to create.' };
  }
  if (prompt.length > GENERATE_IMAGE_PROMPT_MAX_CHARS) {
    return {
      error: `"prompt" is ${prompt.length} characters; keep it at most ${GENERATE_IMAGE_PROMPT_MAX_CHARS}.`,
    };
  }
  let size: ImageSize = 'square';
  if (input.size !== undefined) {
    const known = readImageSize(input.size);
    if (known === undefined) {
      return {
        error:
          '"size" must be "square", "landscape" or "portrait", or a shape such as "16:9".',
      };
    }
    size = known;
  }
  let count = 1;
  if (input.count !== undefined) {
    if (
      typeof input.count !== 'number' ||
      !Number.isInteger(input.count) ||
      input.count < 1 ||
      input.count > GENERATE_IMAGE_COUNT_MAX
    ) {
      return {
        error: `"count" must be a whole number from 1 to ${GENERATE_IMAGE_COUNT_MAX}.`,
      };
    }
    count = input.count;
  }
  const inputImages = stringList(input.inputImages);
  if (inputImages === null) {
    return { error: '"inputImages" must be a list of image refs.' };
  }
  if (inputImages.length > GENERATE_IMAGE_INPUTS_MAX) {
    return {
      error: `Pass at most ${GENERATE_IMAGE_INPUTS_MAX} "inputImages".`,
    };
  }
  return { prompt, size, count, inputImages: [...new Set(inputImages)] };
}

/** A file name for image `index` of `count`, from the first words of the
 * prompt: what a person scanning their downloads recognizes. */
function imageName(
  prompt: string,
  index: number,
  count: number,
  image: GeneratedImage,
): string {
  const words =
    prompt
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .split(/\s+/)
      .filter((word) => word.length > 0)
      .slice(0, 5)
      .join('-') || 'image';
  const stem = words.slice(0, 60);
  const extension = RASTER_EXTENSIONS[image.mediaType];
  return count === 1
    ? `${stem}.${extension}`
    : `${stem}-${index + 1}.${extension}`;
}

export async function runGenerateImage(
  scope: WorkToolScope,
  input: unknown,
): Promise<unknown> {
  const image = scope.image;
  if (image === undefined) {
    return failure(
      'unavailable',
      'Image generation is not available here. Tell the user; do not retry.',
    );
  }
  const args = readArgs(input);
  if ('error' in args) return failure('invalid_args', args.error);

  if (args.inputImages.length > 0 && !image.model.acceptsImageInput) {
    return failure(
      'invalid_args',
      `The image model ${image.model.modelId} cannot start from an image. Describe the picture in the prompt instead.`,
    );
  }
  const refusal = referenceImagesRefusal(image.model, args.inputImages.length);
  if (refusal !== undefined) return failure('invalid_args', refusal);
  const references: ReferenceImage[] = [];
  if (args.inputImages.length > 0) {
    const files = await scope.inputs.resolve(args.inputImages);
    let total = 0;
    for (const ref of args.inputImages) {
      const file = files.get(ref);
      if (file === undefined) {
        return failure(
          'not_found',
          `"${ref}" names no image of this conversation.`,
        );
      }
      if (file.sizeBytes > REFERENCE_IMAGE_MAX_BYTES) {
        return failure(
          'invalid_args',
          `"${file.name}" is larger than ${REFERENCE_IMAGE_MAX_BYTES / (1024 * 1024)} MB, the most a reference image may be.`,
        );
      }
      total += file.sizeBytes;
      if (total > REFERENCE_IMAGES_TOTAL_MAX_BYTES) {
        return failure(
          'invalid_args',
          `The reference images of one call may be at most ${REFERENCE_IMAGES_TOTAL_MAX_BYTES / (1024 * 1024)} MB together.`,
        );
      }
      const { bytes } = await getOrgBlobBytes(
        scope.sql,
        scope.organizationId,
        ref,
      );
      const mediaType = sniffRasterMediaType(bytes);
      if (mediaType === null || !isReferenceMediaType(mediaType)) {
        return failure(
          'invalid_args',
          `"${file.name}" is not a PNG, JPEG or WebP image.`,
        );
      }
      references.push({ bytes, mediaType, fileName: file.name });
    }
  }

  const admission = await image.billing.admit(args.count);
  if (!admission.admitted) {
    return failure(
      'unavailable',
      `${admission.message} No image was generated; do not retry the same call.`,
    );
  }

  const request = prepareImageRequest(image.model, {
    prompt: args.prompt,
    size: args.size,
    references,
  });
  const charges: number[] = [];
  const generated: GeneratedImage[] = [];
  const errors: string[] = [];
  try {
    const outcomes = await Promise.allSettled(
      Array.from({ length: args.count }, () =>
        generateOneImage(image.model, request),
      ),
    );
    for (const outcome of outcomes) {
      if (outcome.status === 'fulfilled') {
        charges.push(outcome.value.costCents);
        generated.push(...outcome.value.images);
        continue;
      }
      const reason: unknown = outcome.reason;
      if (reason instanceof ImageProviderError) {
        if (reason.charge !== undefined) charges.push(reason.charge.costCents);
        errors.push(reason.message);
        continue;
      }
      errors.push('the image request failed');
      console.warn('[generate_image] request failed:', reason);
    }
  } finally {
    await image.billing
      .settle({
        holdCents: admission.holdCents,
        charges,
        provider: image.model.providerSlug,
        model: image.model.modelId,
      })
      .catch((error: unknown) => {
        console.error('[generate_image] booking the spend failed:', error);
      });
  }

  const artifacts: ToolArtifact[] = [];
  const images: Array<{
    ref: string;
    name: string;
    width?: number;
    height?: number;
  }> = [];
  for (const [index, picture] of generated.entries()) {
    const name = imageName(args.prompt, index, generated.length, picture);
    const artifact = await scope.artifacts.store({
      name,
      mediaType: picture.mediaType,
      bytes: picture.bytes,
    });
    artifacts.push(artifact);
    images.push({
      ref: artifact.ref,
      name: artifact.name,
      ...(picture.width !== undefined ? { width: picture.width } : {}),
      ...(picture.height !== undefined ? { height: picture.height } : {}),
    });
  }
  if (artifacts.length === 0) {
    return failure(
      'error',
      `No image came back: ${errors.join('; ') || 'the model returned nothing usable'}.`,
    );
  }
  return {
    status: 'ok',
    model: `${image.model.providerDisplayName} ${image.model.modelId}`,
    images,
    artifacts,
    ...(errors.length > 0
      ? { note: `Some images failed: ${errors.join('; ')}` }
      : {}),
  };
}
