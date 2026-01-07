/**
 * Browser-side image compression utility.
 * Compresses images before upload to stay within server memory limits.
 */

// Maximum image size in bytes (1MB) - matches server-side limit
const MAX_IMAGE_SIZE = 1 * 1024 * 1024;
// Maximum dimension for compressed images
const MAX_DIMENSION = 2048;
// JPEG quality for compression (0-1)
const JPEG_QUALITY = 0.85;

interface CompressImageOptions {
  /** Maximum file size in bytes (default: 1MB) */
  maxSize?: number;
  /** Maximum dimension (width or height) in pixels (default: 2048) */
  maxDimension?: number;
  /** JPEG quality 0-1 (default: 0.85) */
  quality?: number;
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

/**
 * Compress an image file if it exceeds the size limit.
 * Uses canvas to resize and re-encode the image.
 */
export async function compressImage(
  file: File,
  options: CompressImageOptions = {},
): Promise<CompressImageResult> {
  const {
    maxSize = MAX_IMAGE_SIZE,
    maxDimension = MAX_DIMENSION,
    quality = JPEG_QUALITY,
  } = options;

  const originalSize = file.size;

  // Skip compression if file is already small enough
  if (file.size <= maxSize) {
    return {
      file,
      wasCompressed: false,
      originalSize,
      finalSize: originalSize,
    };
  }

  // Only compress image types
  if (!file.type.startsWith('image/')) {
    return {
      file,
      wasCompressed: false,
      originalSize,
      finalSize: originalSize,
    };
  }

  // Skip GIF compression (animated GIFs would lose animation)
  if (file.type === 'image/gif') {
    return {
      file,
      wasCompressed: false,
      originalSize,
      finalSize: originalSize,
    };
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      try {
        // Calculate new dimensions while maintaining aspect ratio
        let { width, height } = img;

        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        // Create canvas and draw resized image
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Failed to get canvas context');
        }

        // Use high-quality image smoothing
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        // Determine output format: keep PNG for transparency, use JPEG otherwise
        // PNG with transparency needs to stay PNG, but regular images compress better as JPEG
        const isPng = file.type === 'image/png';
        const outputType = isPng ? 'image/png' : 'image/jpeg';
        const outputQuality = isPng ? undefined : quality; // PNG doesn't use quality param

        // Convert to blob
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Failed to compress image'));
              return;
            }

            // Update file extension based on output type
            const newExtension = isPng ? '.png' : '.jpg';
            const newFileName = file.name.replace(/\.[^.]+$/, newExtension);
            const compressedFile = new File([blob], newFileName, {
              type: outputType,
              lastModified: Date.now(),
            });

            resolve({
              file: compressedFile,
              wasCompressed: true,
              originalSize,
              finalSize: compressedFile.size,
            });
          },
          outputType,
          outputQuality,
        );
      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image for compression'));
    };

    img.src = objectUrl;
  });
}

/**
 * Compress multiple image files.
 */
async function compressImages(
  files: File[],
  options: CompressImageOptions = {},
): Promise<CompressImageResult[]> {
  return Promise.all(files.map((file) => compressImage(file, options)));
}
