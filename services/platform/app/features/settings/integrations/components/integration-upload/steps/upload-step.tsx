'use client';

import { Upload, AlertCircle, ExternalLink } from 'lucide-react';
import { useState, useCallback } from 'react';

import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { Stack } from '@/app/components/ui/layout/layout';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type { ParsedPackage } from '../utils/parse-integration-package';

import { parseIntegrationFiles } from '../utils/parse-integration-package';

interface UploadStepProps {
  onPackageParsed: (pkg: ParsedPackage) => void;
}

export function UploadStep({ onPackageParsed }: UploadStepProps) {
  const { t } = useT('settings');
  const [error, setError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);

  const handleFilesSelected = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      setError(null);
      setIsParsing(true);

      try {
        const result = await parseIntegrationFiles(files);
        if (result.success && result.data) {
          onPackageParsed(result.data);
        } else {
          setError(result.error ?? t('integrations.upload.parseError'));
        }
      } catch {
        setError(t('integrations.upload.unexpectedError'));
      } finally {
        setIsParsing(false);
      }
    },
    [onPackageParsed, t],
  );

  return (
    <Stack gap={4}>
      <p className="text-muted-foreground text-sm">
        {t('integrations.upload.uploadDescription')}
      </p>

      <FileUpload.Root>
        <FileUpload.DropZone
          onFilesSelected={handleFilesSelected}
          accept=".zip,.json,.js,.png,.svg,.jpg,.jpeg,.webp"
          multiple
          disabled={isParsing}
          inputId="integration-package-upload"
          aria-label={t('integrations.upload.dropZoneLabel')}
          className={cn(
            'border-border hover:border-primary/50 relative flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 transition-colors',
            isParsing && 'pointer-events-none opacity-50',
          )}
        >
          <FileUpload.Overlay
            label={t('integrations.upload.dropHere')}
            className="rounded-lg"
          />
          <Upload className="text-muted-foreground size-8" />
          <Stack gap={1} className="text-center">
            <p className="text-sm font-medium">
              {isParsing
                ? t('integrations.upload.parsing')
                : t('integrations.upload.dropOrClick')}
            </p>
            <p className="text-muted-foreground text-xs">
              {t('integrations.upload.acceptedFormats')}
            </p>
          </Stack>
        </FileUpload.DropZone>
      </FileUpload.Root>

      {error && (
        <div
          className="bg-destructive/10 text-destructive flex items-start gap-2 rounded-md p-3 text-sm"
          role="alert"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <pre className="font-sans whitespace-pre-wrap">{error}</pre>
        </div>
      )}

      <div className="text-muted-foreground text-xs">
        <p className="font-medium">
          {t('integrations.upload.packageStructure')}
        </p>
        <pre className="bg-muted mt-1 rounded p-2 text-xs">
          {`Option A: my-integration.zip\n            ├── config.json\n            ├── connector.js\n            └── icon.svg (optional)\n\nOption B: Select files directly\n            ├── config.json\n            ├── connector.js\n            └── icon.svg (optional)`}
        </pre>
      </div>

      <p className="text-muted-foreground text-xs">
        {t('integrations.upload.examplesHintPrefix')}{' '}
        <a
          href="https://github.com/tale-project/tale/tree/main/examples/integrations"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary font-medium underline underline-offset-2"
        >
          {t('integrations.upload.examplesHintLink')}
          <ExternalLink className="ml-0.5 inline size-3 align-text-bottom" />
        </a>{' '}
        {t('integrations.upload.examplesHintSuffix')}
      </p>
    </Stack>
  );
}
