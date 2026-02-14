'use client';

import { ImagePlus } from 'lucide-react';
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

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
}

function Root({ children }: RootProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  const value = useMemo(
    () => ({
      isDragOver,
      setIsDragOver,
    }),
    [isDragOver],
  );

  return (
    <FileUploadContext.Provider value={value}>
      {children}
    </FileUploadContext.Provider>
  );
}

interface DropZoneProps {
  children: ReactNode;
  className?: string;
  onFilesSelected: (files: File[]) => void;
  accept?: string;
  disabled?: boolean;
  inputId?: string;
  multiple?: boolean;
  clickable?: boolean;
  'aria-label'?: string;
}

function DropZone({
  children,
  className,
  onFilesSelected,
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
      }
    },
    [setIsDragOver, onFilesSelected, disabled],
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
      role={clickable ? 'button' : undefined}
      tabIndex={clickable && !disabled ? 0 : undefined}
      aria-disabled={clickable ? disabled : undefined}
      aria-label={clickable ? ariaLabel : undefined}
      className={className}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={clickable ? handleClick : undefined}
      onKeyDown={clickable ? handleKeyDown : undefined}
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
        'absolute inset-0 border-2 border-dashed border-info-foreground flex flex-col items-center justify-center z-50 gap-2 bg-info',
        className,
      )}
    >
      <ImagePlus className="text-muted-foreground size-8" />
      <span className="text-muted-foreground text-sm">
        {label ?? t('upload.dropFilesHere')}
      </span>
    </div>
  );
}

export const FileUpload = {
  Root,
  DropZone,
  Overlay,
  useContext: useFileUploadContext,
};
