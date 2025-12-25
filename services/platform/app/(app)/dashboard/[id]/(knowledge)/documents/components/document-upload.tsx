'use client';

import { useRef, ChangeEvent } from 'react';
import { Monitor } from 'lucide-react';
import { useDocumentUpload } from '../hooks/use-document-upload';
import { cn } from '@/lib/utils/cn';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';

interface DocumentUploadProps {
  organizationId: string;
  onUploadComplete?: () => void;
}

export default function DocumentUpload({
  organizationId,
  onUploadComplete,
}: DocumentUploadProps) {
  const { t } = useT('documents');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { uploadFiles, isUploading, cancelUpload } = useDocumentUpload({
    organizationId,
    onSuccess: onUploadComplete,
  });

  const handleFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []) as File[];
    if (files.length === 0) return;

    await uploadFiles(files);

    // Reset the input
    if (event.target) {
      event.target.value = '';
    }
  };

  return (
    <div className="w-full space-y-4">
      {/* Upload Area */}
      <div
        className={cn(
          'w-full border rounded-lg p-3 cursor-pointer transition-colors hover:bg-muted',
          isUploading && 'opacity-50 cursor-not-allowed',
        )}
        onClick={!isUploading ? handleFileSelect : undefined}
      >
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-md bg-muted flex items-center justify-center">
            <Monitor className="size-4 text-foreground" />
          </div>
          <div className="text-left">
            <div className="font-medium">{t('upload.fromComputer')}</div>
            <div className="text-sm text-muted-foreground">
              {t('upload.fromComputerDescription')}
            </div>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          disabled={isUploading}
          accept="application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain,image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {/* Upload Status */}
      {isUploading && (
        <div className="p-3 border rounded-lg bg-secondary/20">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{t('upload.uploading')}</span>
            <Button
              variant="outline"
              onClick={cancelUpload}
              className="text-red-600 hover:text-red-700"
            >
              {t('upload.cancelUpload')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
