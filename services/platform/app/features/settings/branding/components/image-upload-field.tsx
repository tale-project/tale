'use client';

import { Plus, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { Id } from '@/convex/_generated/dataModel';

import { Image } from '@/app/components/ui/data-display/image';
import { Spinner } from '@/app/components/ui/feedback/spinner';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';
import { cn } from '@/lib/utils/cn';

const ACCEPTED_IMAGE_TYPES = '.png,.svg,.jpg,.jpeg,.webp';

interface ImageUploadFieldProps {
  currentUrl?: string | null;
  onUpload: (storageId: Id<'_storage'>) => void;
  onRemove?: () => void;
  size?: 'sm' | 'md';
  label?: string;
  ariaLabel: string;
}

export function ImageUploadField({
  currentUrl,
  onUpload,
  onRemove,
  size = 'sm',
  label,
  ariaLabel,
}: ImageUploadFieldProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isRemoved, setIsRemoved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const generateUploadUrl = useConvexMutation(
    api.files.mutations.generateUploadUrl,
  );

  const displayUrl = isRemoved ? null : (previewUrl ?? currentUrl);

  useEffect(() => {
    setIsRemoved(false);
  }, [currentUrl]);

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
      setIsRemoved(false);
      setIsUploading(true);

      try {
        const uploadUrl = await generateUploadUrl.mutateAsync({});
        const result = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': file.type },
          body: file,
        });
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex storage upload response shape
        const { storageId } = (await result.json()) as {
          storageId: Id<'_storage'>;
        };
        onUpload(storageId);
      } catch {
        setPreviewUrl(null);
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
    [generateUploadUrl, onUpload],
  );

  const handleRemove = useCallback(() => {
    setPreviewUrl(null);
    setIsRemoved(true);
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    onRemove?.();
  }, [onRemove]);

  const sizeClasses = size === 'sm' ? 'size-10' : 'size-12';

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="relative">
        <button
          type="button"
          onClick={handleClick}
          disabled={isUploading}
          className={cn(
            'border-input flex items-center justify-center overflow-clip rounded-lg border bg-white shadow-sm',
            sizeClasses,
            isUploading && 'cursor-wait opacity-60',
          )}
          aria-label={ariaLabel}
        >
          {isUploading ? (
            <Spinner className="size-4" />
          ) : displayUrl ? (
            <Image
              src={displayUrl}
              alt=""
              className="size-full object-contain p-1"
              width={48}
              height={48}
            />
          ) : (
            <Plus className="text-muted-foreground size-3.5" />
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
        <span className="text-muted-foreground text-xs font-medium">
          {label}
        </span>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES}
        onChange={handleFileChange}
        className="hidden"
        tabIndex={-1}
      />
    </div>
  );
}
