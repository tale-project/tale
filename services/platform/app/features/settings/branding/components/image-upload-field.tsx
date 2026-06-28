'use client';

import { VStack } from '@tale/ui/layout';
import { Spinner } from '@tale/ui/spinner';
import { Text } from '@tale/ui/text';
import { Plus, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Image } from '@/app/components/ui/data-display/image';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useSaveImage } from '../hooks/mutations';
import { imageUploadErrorToastKey } from '../utils/image-upload-error';

const ACCEPTED_IMAGE_TYPES = '.png,.svg,.jpg,.jpeg,.webp,.ico';

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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isRemoved, setIsRemoved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const prevCurrentUrlRef = useRef(currentUrl);
  const saveImage = useSaveImage();
  const { toast } = useToast();
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

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }

      const objectUrl = URL.createObjectURL(file);
      objectUrlRef.current = objectUrl;
      setPreviewUrl(objectUrl);
      onPreviewUrlChange?.(objectUrl);
      setIsRemoved(false);
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
        // server's `ConvexError` code (too large / unsupported type, etc.).
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
          disabled={isUploading}
          className={cn(
            'border-border flex items-center justify-center overflow-clip rounded-lg border bg-background shadow-xs',
            sizeClasses,
            isUploading && 'cursor-wait opacity-60',
          )}
          aria-label={ariaLabel}
        >
          {isUploading ? (
            <Spinner className="size-4" />
          ) : displayUrl ? (
            previewUrl ? (
              <img
                src={previewUrl}
                alt=""
                className="size-full object-contain"
                width={48}
                height={48}
              />
            ) : (
              <Image
                src={displayUrl}
                alt=""
                className="size-full object-contain"
                width={48}
                height={48}
              />
            )
          ) : (
            <Plus className="text-muted-foreground size-4 shrink-0" />
          )}
        </button>
        {displayUrl && !isUploading && onRemove && (
          <button
            type="button"
            onClick={handleRemove}
            className="bg-foreground text-background absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full"
            aria-label={`Remove ${label ?? 'image'}`}
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
      />
    </VStack>
  );
}
