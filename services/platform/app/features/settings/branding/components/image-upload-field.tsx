'use client';

import { VStack } from '@tale/ui/layout';
import { Spinner } from '@tale/ui/spinner';
import { Text } from '@tale/ui/text';
import { Plus, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Image } from '@/app/components/ui/data-display/image';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useSaveImage } from '../hooks/mutations';
import { imageUploadErrorToastKey } from '../utils/image-upload-error';

const ACCEPTED_IMAGE_TYPES = '.png,.svg,.jpg,.jpeg,.webp,.ico';
const ACCEPTED_EXTENSIONS = ['.png', '.svg', '.jpg', '.jpeg', '.webp', '.ico'];

/**
 * Raster logos below this edge length render blurry in the sidebar/header
 * chrome (48px box on 2x displays). SVGs are exempt — vectors have no pixel
 * floor.
 */
const MIN_LOGO_PIXELS = 64;

function isSvg(file: File): boolean {
  return (
    file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')
  );
}

/**
 * Measure a raster image's intrinsic pixel size. Returns `null` when the
 * browser cannot decode it — the server-side validation then remains the
 * gate, rather than a decode hiccup blocking a valid upload.
 */
async function imagePixelSize(
  file: File,
): Promise<{ width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch (err) {
    console.warn('[ImageUploadField] could not measure image', err);
    return null;
  }
}

// Mirror the `<input accept>` list for the drag-and-drop path. Some valid
// uploads report an empty or non-`image/*` MIME type (e.g. a `.ico` whose
// browser-reported type is blank), so fall back to the file extension rather
// than rejecting them — keeping picker and drop acceptance in sync.
function isAcceptedImage(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  const name = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

interface ImageUploadFieldProps {
  organizationId: string;
  currentUrl?: string | null;
  imageType: 'logo' | 'favicon-light' | 'favicon-dark';
  onUpload: (filename: string, file: File) => void;
  onRemove?: () => void;
  onPreviewUrlChange?: (url: string | null) => void;
  size?: 'sm' | 'md';
  label?: string;
  ariaLabel: string;
}

export function ImageUploadField({
  organizationId,
  currentUrl,
  imageType,
  onUpload,
  onRemove,
  onPreviewUrlChange,
  size = 'sm',
  label,
  ariaLabel,
}: ImageUploadFieldProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isRemoved, setIsRemoved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const prevCurrentUrlRef = useRef(currentUrl);
  const saveImage = useSaveImage();
  const { toast } = useToast();
  const { t } = useT('settings');
  const { t: tToast } = useT('toast');

  if (prevCurrentUrlRef.current !== currentUrl) {
    prevCurrentUrlRef.current = currentUrl;
    if (isRemoved) {
      setIsRemoved(false);
    }
  }

  const displayUrl = isRemoved ? null : (previewUrl ?? currentUrl);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  const handleClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const uploadFile = useCallback(
    async (file: File) => {
      // Gate the logo on a minimum raster size BEFORE any preview state so a
      // rejected file never flashes into the preview or the live form.
      if (imageType === 'logo' && !isSvg(file)) {
        const pixelSize = await imagePixelSize(file);
        if (
          pixelSize &&
          (pixelSize.width < MIN_LOGO_PIXELS ||
            pixelSize.height < MIN_LOGO_PIXELS)
        ) {
          toast({
            title: tToast('error.logoTooSmall', { min: MIN_LOGO_PIXELS }),
            variant: 'destructive',
          });
          return;
        }
      }

      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }

      const objectUrl = URL.createObjectURL(file);
      objectUrlRef.current = objectUrl;
      setPreviewUrl(objectUrl);
      onPreviewUrlChange?.(objectUrl);
      setIsRemoved(false);
      setIsDragging(false);
      setIsUploading(true);

      try {
        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);
        const result = await saveImage.mutateAsync({
          organizationId,
          type: imageType,
          base64,
          mimeType: file.type,
        });
        onUpload(result.filename, file);
      } catch (err) {
        // Surface the failure instead of silently dropping the preview: log for
        // diagnostics and show a destructive toast whose message reflects the
        // server's `AppError` code (too large / unsupported type, etc.).
        console.error('[ImageUploadField] image upload failed', err);
        toast({
          title: tToast(imageUploadErrorToastKey(err)),
          variant: 'destructive',
        });
        setPreviewUrl(null);
        onPreviewUrlChange?.(null);
        if (objectUrlRef.current) {
          URL.revokeObjectURL(objectUrlRef.current);
          objectUrlRef.current = null;
        }
      } finally {
        setIsUploading(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    },
    [
      organizationId,
      saveImage,
      imageType,
      onUpload,
      onPreviewUrlChange,
      toast,
      tToast,
    ],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void uploadFile(file);
    },
    [uploadFile],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!isUploading) setIsDragging(true);
    },
    [isUploading],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (isUploading) return;
      const file = e.dataTransfer.files?.[0];
      if (file && isAcceptedImage(file)) void uploadFile(file);
    },
    [isUploading, uploadFile],
  );

  const handleRemove = useCallback(() => {
    setPreviewUrl(null);
    onPreviewUrlChange?.(null);
    setIsRemoved(true);
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    onRemove?.();
  }, [onRemove, onPreviewUrlChange]);

  const sizeClasses = size === 'sm' ? 'size-10' : 'size-12';

  return (
    <VStack gap={1} align="start">
      <div className="relative">
        <button
          type="button"
          onClick={handleClick}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          disabled={isUploading}
          className={cn(
            'group border-border ring-offset-background bg-background relative flex cursor-pointer items-center justify-center overflow-clip rounded-lg border shadow-xs transition-all duration-150',
            'hover:border-border-strong hover:bg-bg-elevated',
            'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
            'active:scale-[0.97] active:duration-75 motion-reduce:transition-none motion-reduce:active:scale-100',
            sizeClasses,
            isDragging && 'border-accent-base ring-accent-base ring-1',
            isUploading && 'cursor-wait opacity-60',
          )}
          aria-label={ariaLabel}
        >
          {isUploading ? (
            <Spinner className="size-4" />
          ) : displayUrl ? (
            <>
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt=""
                  className="pointer-events-none size-full object-contain"
                  width={48}
                  height={48}
                />
              ) : (
                <Image
                  src={displayUrl}
                  alt=""
                  className="pointer-events-none size-full object-contain"
                  width={48}
                  height={48}
                />
              )}
              <span className="bg-foreground/60 pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none">
                <Upload className="text-background size-4 shrink-0" />
              </span>
            </>
          ) : (
            <Plus className="text-muted-foreground group-hover:text-foreground pointer-events-none size-4 shrink-0 transition-colors duration-150 motion-reduce:transition-none" />
          )}
        </button>
        {displayUrl && !isUploading && onRemove && (
          <button
            type="button"
            onClick={handleRemove}
            className="bg-foreground text-background ring-offset-background focus-visible:ring-ring absolute -top-1 -right-1 flex size-4 cursor-pointer items-center justify-center rounded-full transition-transform duration-150 hover:scale-110 focus-visible:ring-1 focus-visible:ring-offset-2 focus-visible:outline-none motion-reduce:transition-none motion-reduce:hover:scale-100"
            aria-label={t('branding.removeImageAria', {
              label: label ?? t('branding.imageFallback'),
            })}
          >
            <X className="size-2.5" />
          </button>
        )}
      </div>
      {label && (
        <Text as="span" variant="caption" className="font-medium">
          {label}
        </Text>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES}
        onChange={handleFileChange}
        className="hidden"
        tabIndex={-1}
        aria-label={ariaLabel}
      />
    </VStack>
  );
}
