'use client';

import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { AlertCircle, Upload } from 'lucide-react';
import { useCallback, useState } from 'react';

import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import {
  parseSkillBundle,
  type ParsedSkillBundle,
} from '../utils/parse-skill-bundle';

interface UploadStepProps {
  onBundleParsed: (bundle: ParsedSkillBundle) => void;
}

export function UploadStep({ onBundleParsed }: UploadStepProps) {
  const { t } = useT('settings');
  const [error, setError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);

  const handleFilesSelected = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const zip = files.find((f) => f.name.toLowerCase().endsWith('.zip'));
      if (!zip) {
        setError(
          t('skills.upload.zipRequired', {
            defaultValue: 'Bundle must be a .zip file.',
          }),
        );
        return;
      }
      setError(null);
      setIsParsing(true);
      try {
        const result = await parseSkillBundle(zip);
        if (result.success) {
          onBundleParsed(result.data);
        } else {
          setError(result.error);
        }
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : t('skills.upload.unexpectedError', {
                defaultValue: 'An unexpected error occurred',
              }),
        );
      } finally {
        setIsParsing(false);
      }
    },
    [onBundleParsed, t],
  );

  return (
    <Stack gap={4}>
      <Text variant="muted">
        {t('skills.upload.uploadDescription', {
          defaultValue:
            'Upload a zip containing SKILL.md at the root, plus any optional scripts, references, or assets.',
        })}
      </Text>

      <FileUpload.Root>
        <FileUpload.DropZone
          onFilesSelected={handleFilesSelected}
          accept=".zip"
          disabled={isParsing}
          inputId="skill-bundle-upload"
          aria-label={t('skills.upload.dropZoneLabel', {
            defaultValue: 'Upload skill bundle',
          })}
          className={cn(
            'border-border hover:border-primary/50 focus-visible:border-ring relative flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 transition-colors outline-none focus-visible:border-solid',
            isParsing && 'pointer-events-none opacity-50',
          )}
        >
          <FileUpload.Overlay
            label={t('skills.upload.dropHere', {
              defaultValue: 'Drop the bundle here',
            })}
            className="rounded-lg"
          />
          <Upload className="text-muted-foreground size-8" />
          <Stack gap={1} className="text-center">
            <Text variant="label">
              {isParsing
                ? t('skills.upload.parsing', {
                    defaultValue: 'Reading bundle…',
                  })
                : t('skills.upload.dropOrClick', {
                    defaultValue: 'Drop a .zip here or click to browse',
                  })}
            </Text>
            <Text variant="caption">
              {t('skills.upload.acceptedFormats', {
                defaultValue: 'Zip containing SKILL.md at the root',
              })}
            </Text>
          </Stack>
        </FileUpload.DropZone>
      </FileUpload.Root>

      {error ? (
        <div
          className="bg-destructive/10 text-destructive flex items-start gap-2 rounded-md p-3 text-sm"
          role="alert"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <pre className="font-sans whitespace-pre-wrap">{error}</pre>
        </div>
      ) : null}
    </Stack>
  );
}
