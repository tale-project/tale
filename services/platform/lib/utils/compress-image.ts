/**
 * Browser-side image compression for chat and task attachments.
 *
 * An image larger than the 1 MB aim is redrawn on a canvas before upload:
 * its longer side capped at 2048 px, a PNG kept as a PNG (it may carry
 * transparency), every other image encoded as a JPEG. When the redrawn
 * image is still larger than the largest image a chat model is shown
 * (`CHAT_IMAGE_MODEL_MAX_SIZE`), it steps down until it fits: an image
 * without a transparent pixel becomes a JPEG at a lower quality, then at
 * smaller sizes; one with transparency stays a PNG at smaller sizes first,
 * and is drawn on white as a JPEG only when no PNG size fits. A detailed
 * PNG (a scan, a photo, a busy screenshot) hardly shrinks when it is only
 * resized, so before this step it left the composer too large for the model
 * to see. An original already within the limit is never stepped down: it is
 * redrawn as before, and kept when the redraw is no smaller. Only the chat
 * composer gives a limit; a task's files, which an agent reads as files, are
 * redrawn as before and nothing more.
 */

/** The size from which an image is redrawn at all (1 MB). */
const MAX_IMAGE_SIZE = 1 * 1024 * 1024;
/** The longest side of a redrawn image, in pixels. */
const MAX_DIMENSION = 2048;
/** JPEG quality of the first redraw (0-1). */
const JPEG_QUALITY = 0.85;

/**
 * The JPEG encodings tried in order once the first redraw is over the
 * limit, each capping the longer side and setting the quality. Models look
 * at far fewer pixels than 2048 per side, so a smaller size costs them
 * little; the last rung fits any image.
 */
const JPEG_STEPS: readonly { maxDimension: number; quality: number }[] = [
  { maxDimension: 2048, quality: 0.7 },
  { maxDimension: 1600, quality: 0.7 },
  { maxDimension: 1280, quality: 0.7 },
  { maxDimension: 1024, quality: 0.6 },
  { maxDimension: 768, quality: 0.6 },
  { maxDimension: 512, quality: 0.5 },
];

/** The sizes an image with transparency is tried at as a PNG before it is
 * drawn on white as a JPEG. */
const PNG_STEPS: readonly number[] = [1600, 1280, 1024];

/** What a JPEG of an image with transparency is drawn on. */
const JPEG_BACKGROUND = '#ffffff';

type EncodedType = 'image/png' | 'image/jpeg';

/** One encoding of the decoded image. */
export interface EncodeRequest {
  readonly width: number;
  readonly height: number;
  readonly type: EncodedType;
  /** JPEG quality (0-1); a PNG has none. */
  readonly quality?: number;
  /** A colour the canvas is filled with before the image is drawn. */
  readonly background?: string;
}

/** What fitting an image needs from its decoded pixels: its size, whether
 * any pixel is less than opaque, and a way to encode it. */
export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  /** Whether a pixel of the image drawn at this size is less than opaque. */
  hasTransparency(width: number, height: number): boolean;
  encode(request: EncodeRequest): Promise<Blob>;
}

interface FitOptions {
  /** The type the picked file has. */
  readonly sourceType: string;
  /** The size of the picked file, in bytes. */
  readonly originalSize: number;
  /** The longest side of the first redraw. */
  readonly maxDimension: number;
  /** JPEG quality of the first redraw. */
  readonly quality: number;
  /** The size the result must not exceed, in bytes. */
  readonly limit: number;
}

interface FittedImage {
  readonly blob: Blob;
  readonly type: EncodedType;
}

/** `width`×`height` scaled down so its longer side is at most
 * `maxDimension`; an image already within it keeps its size. */
function scaledSize(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number } {
  if (width <= maxDimension && height <= maxDimension) {
    return { width, height };
  }
  return width > height
    ? {
        width: maxDimension,
        height: Math.max(1, Math.round((height * maxDimension) / width)),
      }
    : {
        width: Math.max(1, Math.round((width * maxDimension) / height)),
        height: maxDimension,
      };
}

/**
 * Encode `image` so it fits `limit`: first as the composer always redrew an
 * image (longer side capped, a PNG kept as a PNG, everything else a JPEG),
 * then down the steps described at the top of this file, until one fits.
 * Returns the smallest encoding tried when none does (only an image whose
 * every step is larger than `limit`, which the last JPEG step makes all but
 * impossible); the caller compares its size with the limit. Returns `null`
 * when the original, already within the limit, is to be kept as it is: its
 * redraw came out no smaller.
 */
export async function fitImage(
  image: DecodedImage,
  options: FitOptions,
): Promise<FittedImage | null> {
  const sized = (maxDimension: number) =>
    scaledSize(
      image.width,
      image.height,
      Math.min(maxDimension, options.maxDimension),
    );
  const keepPng = options.sourceType === 'image/png';
  const first = sized(options.maxDimension);
  const firstType: EncodedType = keepPng ? 'image/png' : 'image/jpeg';
  const firstBlob = await image.encode({
    ...first,
    type: firstType,
    ...(keepPng
      ? {}
      : { quality: options.quality, background: JPEG_BACKGROUND }),
  });
  // An original within the limit is shown to a model as it is: a redraw
  // replaces it only to be smaller, never to step it down further.
  if (options.originalSize <= options.limit) {
    return firstBlob.size < options.originalSize
      ? { blob: firstBlob, type: firstType }
      : null;
  }
  if (firstBlob.size <= options.limit) {
    return { blob: firstBlob, type: firstType };
  }

  let smallest: FittedImage = { blob: firstBlob, type: firstType };
  const keepSmallest = (fitted: FittedImage) => {
    if (fitted.blob.size < smallest.blob.size) smallest = fitted;
  };

  // A PNG with transparency keeps it while a smaller PNG fits.
  if (keepPng && image.hasTransparency(first.width, first.height)) {
    for (const maxDimension of PNG_STEPS) {
      const size = sized(maxDimension);
      if (size.width >= first.width && size.height >= first.height) continue;
      const blob = await image.encode({ ...size, type: 'image/png' });
      const fitted: FittedImage = { blob, type: 'image/png' };
      if (blob.size <= options.limit) return fitted;
      keepSmallest(fitted);
    }
  }

  for (const step of JPEG_STEPS) {
    const blob = await image.encode({
      ...sized(step.maxDimension),
      type: 'image/jpeg',
      quality: Math.min(step.quality, options.quality),
      background: JPEG_BACKGROUND,
    });
    const fitted: FittedImage = { blob, type: 'image/jpeg' };
    if (blob.size <= options.limit) return fitted;
    keepSmallest(fitted);
  }
  return smallest;
}

interface CompressImageOptions {
  /** The size from which an image is redrawn, in bytes (default: 1 MB). */
  maxSize?: number;
  /** Maximum dimension (width or height) in pixels (default: 2048) */
  maxDimension?: number;
  /** JPEG quality 0-1 (default: 0.85) */
  quality?: number;
  /** The size a redrawn image must fit, in bytes: the largest image the
   * conversation's model is shown. Without it an image is only redrawn. */
  limit?: number;
}

interface CompressImageResult {
  /** The compressed file (or original if no compression needed) */
  file: File;
  /** Whether the image was compressed */
  wasCompressed: boolean;
  /** Original file size in bytes */
  originalSize: number;
  /** Final file size in bytes */
  finalSize: number;
}

/** The decoded image on a canvas: draws it at any size, on a background
 * when asked, and encodes it with the browser's own encoders. */
function canvasImage(img: HTMLImageElement): DecodedImage {
  const canvas = document.createElement('canvas');
  const draw = (width: number, height: number, background?: string) => {
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get canvas context');
    }
    if (background !== undefined) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
    }
    // Use high-quality image smoothing
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);
    return ctx;
  };
  return {
    width: img.naturalWidth,
    height: img.naturalHeight,
    hasTransparency(width, height) {
      const { data } = draw(width, height).getImageData(0, 0, width, height);
      for (let alpha = 3; alpha < data.length; alpha += 4) {
        if (data[alpha] !== 255) return true;
      }
      return false;
    },
    encode({ width, height, type, quality, background }) {
      draw(width, height, background);
      return new Promise((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
              return;
            }
            reject(new Error('Failed to compress image'));
          },
          type,
          quality,
        );
      });
    },
  };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.addEventListener('load', () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    });
    img.addEventListener('error', () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image for compression'));
    });
    img.src = objectUrl;
  });
}

/**
 * Compress an image file if it exceeds the size aim: redraw it, and, given a
 * `limit`, step it down until it fits (see the top of this file). An animated
 * GIF is left as it is, since a redraw would keep only its first frame.
 */
export async function compressImage(
  file: File,
  options: CompressImageOptions = {},
): Promise<CompressImageResult> {
  const {
    maxSize = MAX_IMAGE_SIZE,
    maxDimension = MAX_DIMENSION,
    quality = JPEG_QUALITY,
    limit = Number.POSITIVE_INFINITY,
  } = options;

  const originalSize = file.size;
  const unchanged: CompressImageResult = {
    file,
    wasCompressed: false,
    originalSize,
    finalSize: originalSize,
  };

  // Skip compression if file is already small enough
  if (file.size <= maxSize) return unchanged;

  // Only compress image types
  if (!file.type.startsWith('image/')) return unchanged;

  // Skip GIF compression (animated GIFs would lose animation)
  if (file.type === 'image/gif') return unchanged;

  const img = await loadImage(file);
  const fitted = await fitImage(canvasImage(img), {
    sourceType: file.type,
    originalSize: file.size,
    maxDimension,
    quality,
    limit,
  });
  if (fitted === null) return unchanged;

  // Update file extension based on output type
  const newExtension = fitted.type === 'image/png' ? '.png' : '.jpg';
  const newFileName = /\.[^.]+$/.test(file.name)
    ? file.name.replace(/\.[^.]+$/, newExtension)
    : `${file.name}${newExtension}`;
  const compressedFile = new File([fitted.blob], newFileName, {
    type: fitted.type,
    lastModified: Date.now(),
  });

  return {
    file: compressedFile,
    wasCompressed: true,
    originalSize,
    finalSize: compressedFile.size,
  };
}
