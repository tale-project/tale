'use client';

import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { AlertCircle, Upload } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

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

  // Window-level drop guard: if the user misses the dropzone by a pixel,
  // the browser default is to navigate away from the page to the dropped
  // file (`file://…/bundle.zip`), losing all dialog state. Cancel the
  // default for any drop while this step is mounted.
  useEffect(() => {
    const prevent = (e: DragEvent) => {
      e.preventDefault();
    };
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  const handleFilesSelected = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      // A folder drop on Chromium reports zero size + empty type and no
      // `.zip` extension. Flag it specifically — the generic "must be a
      // .zip" message leaves users confused about why their working
      // directory was rejected.
      const folderDrop = files.find((f) => f.size === 0 && f.type === '');
      if (folderDrop) {
        setError(
          t('skills.upload.folderUnsupported', {
            defaultValue:
              "Folders aren't supported — please zip the folder first.",
          }),
        );
        return;
      }
      if (files.length > 1) {
        setError(
          t('skills.upload.singleFileOnly', {
            defaultValue: 'Drop a single .zip bundle, not multiple files.',
          }),
        );
        return;
      }
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
        // Capture in console alongside the UI surfacing so devtools can
        // correlate when JSZip throws on a corrupt file.
        console.warn('[skill-upload] parseSkillBundle threw:', err);
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
        <Row
          gap={2}
          align="start"
          className="bg-destructive/10 text-destructive rounded-md p-3 text-sm"
          role="alert"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <pre className="font-sans whitespace-pre-wrap">{error}</pre>
        </Row>
      ) : null}
    </Stack>
  );
}
