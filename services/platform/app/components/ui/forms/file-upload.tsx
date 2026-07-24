'use client';

import { Description } from '@tale/ui/description';
import { SkeletonBox } from '@tale/ui/skeleton';
import { useSkeleton } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { ImagePlus, Info } from 'lucide-react';
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useId,
  useMemo,
  type ReactNode,
} from 'react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { FieldShell } from './field-shell';
import { Label } from './label';

interface FileUploadContextValue {
  isDragOver: boolean;
  setIsDragOver: (value: boolean) => void;
}

const FileUploadContext = createContext<FileUploadContextValue | null>(null);

function useFileUploadContext() {
  const context = useContext(FileUploadContext);
  if (!context) {
    throw new Error(
      'FileUpload components must be used within FileUpload.Root',
    );
  }
  return context;
}

interface RootProps {
  children: ReactNode;
  label?: string;
  description?: ReactNode;
  errorMessage?: string;
  required?: boolean;
  id?: string;
  className?: string;
}

function Root({
  children,
  label,
  description,
  errorMessage,
  required,
  id: providedId,
  className,
}: RootProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const errorId = `${id}-error`;
  const descriptionId = `${id}-description`;
  const hasError = !!errorMessage;
  const [showShake, setShowShake] = useState(false);

  useEffect(() => {
    if (hasError) {
      setShowShake(true);
      const timer = setTimeout(() => setShowShake(false), 400);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [hasError, errorMessage]);

  const value = useMemo(
    () => ({
      isDragOver,
      setIsDragOver,
    }),
    [isDragOver],
  );

  const content = (
    <FileUploadContext.Provider value={value}>
      {children}
    </FileUploadContext.Provider>
  );

  if (!label && !description && !errorMessage) {
    return content;
  }

  return (
    <FieldShell
      // A drop zone is a surface to aim at, not a one-line value: it keeps the
      // full width of the control column even in label-left layouts.
      wideControl
      {...(label
        ? {
            label: (
              <Label htmlFor={id} required={required} error={hasError}>
                {label}
              </Label>
            ),
          }
        : {})}
      {...(description
        ? {
            description: (
              <Description id={descriptionId}>{description}</Description>
            ),
          }
        : {})}
      {...(errorMessage
        ? {
            error: (
              <Text
                id={errorId}
                role="alert"
                aria-live="polite"
                variant="error"
                className="flex items-center gap-1.5"
              >
                <Info className="size-4" aria-hidden="true" />
                {errorMessage}
              </Text>
            ),
          }
        : {})}
      {...(className !== undefined ? { className } : {})}
    >
      <div className={cn(showShake && 'animate-shake')}>{content}</div>
    </FieldShell>
  );
}

interface DropZoneProps {
  children: ReactNode;
  className?: string;
  onFilesSelected: (files: File[]) => void;
  /**
   * Optional text-drop handler. Fires when the drop carries no files but
   * does carry a `text/uri-list` or `text/plain` payload (e.g. user
   * dragged a URL from the browser address bar). Receives the raw text;
   * caller decides whether to extract URLs, ingest as a chat message,
   * etc. Without this, URL drops are silently dropped (R2 review M3).
   */
  onTextDrop?: (text: string) => void;
  accept?: string;
  disabled?: boolean;
  inputId?: string;
  multiple?: boolean;
  clickable?: boolean;
  'aria-label'?: string;
}

// Plain control — the real interactive drop zone (+ hidden file input). No
// skeleton logic of its own.
function DropZoneBase({
  children,
  className,
  onFilesSelected,
  onTextDrop,
  accept,
  disabled,
  inputId = 'file-upload',
  multiple,
  clickable = true,
  'aria-label': ariaLabel,
}: DropZoneProps) {
  const { setIsDragOver } = useFileUploadContext();

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled) {
        setIsDragOver(true);
      }
    },
    [setIsDragOver, disabled],
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const { relatedTarget } = e;
      if (
        !(relatedTarget instanceof Node) ||
        !e.currentTarget.contains(relatedTarget)
      ) {
        setIsDragOver(false);
      }
    },
    [setIsDragOver],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      if (disabled) return;

      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        onFilesSelected(Array.from(files));
        return;
      }
      // No files — check for a text drop (URL from address bar, link
      // text, etc.). Prefer the W3C-standard `text/uri-list`; fall back
      // to `text/plain` for older sources.
      if (onTextDrop) {
        const uriList = e.dataTransfer.getData('text/uri-list');
        const plain = e.dataTransfer.getData('text/plain');
        const text = uriList || plain;
        if (text) onTextDrop(text);
      }
    },
    [setIsDragOver, onFilesSelected, onTextDrop, disabled],
  );

  const handleClick = useCallback(() => {
    if (disabled || !clickable) return;
    const input = document.getElementById(inputId);
    if (input instanceof HTMLInputElement) {
      input.click();
    }
  }, [inputId, disabled, clickable]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled || !clickable) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleClick();
      }
    },
    [handleClick, disabled, clickable],
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = e.target.files;
      if (selectedFiles && selectedFiles.length > 0) {
        onFilesSelected(Array.from(selectedFiles));
      }
      e.target.value = '';
    },
    [onFilesSelected],
  );

  return (
    <div
      role="group"
      // Visible keyboard focus indicator. The DropZone is focusable when
      // `clickable` is set, and previously had no `focus-visible:` style
      // — tabbing into the composer hit this element with zero feedback.
      // Concatenate via template literal so consumers can still pass
      // their own className.
      className={cn(
        clickable &&
          !disabled &&
          'focus-visible:ring-ring rounded focus-visible:ring-2 focus-visible:outline-none',
        clickable && disabled && 'cursor-not-allowed',
        className,
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={clickable ? handleClick : undefined}
      onKeyDown={clickable ? handleKeyDown : undefined}
      tabIndex={clickable && !disabled ? 0 : undefined}
      aria-disabled={clickable ? disabled : undefined}
      aria-label={ariaLabel}
    >
      {children}
      {clickable && (
        <input
          id={inputId}
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={handleFileInputChange}
          className="hidden"
          disabled={disabled}
        />
      )}
    </div>
  );
}

/**
 * Skeleton-aware DropZone. Inside a `<Skeletonize loading>` it masks the plain
 * control by rendering it inside a `<SkeletonBox>` — laid out invisibly to set
 * the exact size, pulse overlay on top — so the skeleton can never drift.
 */
function DropZone(props: DropZoneProps) {
  const loading = useSkeleton();
  if (loading) {
    return (
      <SkeletonBox>
        <DropZoneBase {...props} />
      </SkeletonBox>
    );
  }
  return <DropZoneBase {...props} />;
}

interface OverlayProps {
  className?: string;
  label?: string;
}

function Overlay({ className, label }: OverlayProps) {
  const { t } = useT('common');
  const { isDragOver } = useFileUploadContext();

  if (!isDragOver) return null;

  return (
    <div
      className={cn(
        'absolute -inset-px flex flex-col items-center justify-center z-50 gap-2 bg-info border-2 border-dashed border-info-foreground',
        className,
      )}
    >
      <ImagePlus className="text-muted-foreground size-8" />
      <Text as="span" variant="muted">
        {label ?? t('upload.dropFilesHere')}
      </Text>
    </div>
  );
}

export const FileUpload = {
  Root,
  DropZone,
  Overlay,
  useContext: useFileUploadContext,
};
