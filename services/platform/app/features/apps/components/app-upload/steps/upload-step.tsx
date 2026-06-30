'use client';

import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { AlertCircle, FolderUp, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import {
  parseAppBundle,
  parseAppFolder,
  type ParsedAppBundle,
  type ParseResult,
} from '../utils/parse-app-bundle';

interface UploadStepProps {
  onBundleParsed: (bundle: ParsedAppBundle) => void;
}

export function UploadStep({ onBundleParsed }: UploadStepProps) {
  const { t } = useT('apps');
  const [error, setError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  // `webkitdirectory` is a non-standard attribute React's typed props don't
  // accept; set it imperatively so the input opens a folder picker.
  useEffect(() => {
    const input = folderInputRef.current;
    if (input) {
      input.setAttribute('webkitdirectory', '');
      input.setAttribute('directory', '');
    }
  }, []);

  // Window-level drop guard: a near-miss on the dropzone would otherwise make
  // the browser navigate away to the dropped file, losing all dialog state.
  useEffect(() => {
    const prevent = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  const runParse = useCallback(
    async (parse: () => Promise<ParseResult>) => {
      setError(null);
      setIsParsing(true);
      try {
        const result = await parse();
        if (result.success) {
          onBundleParsed(result.data);
        } else {
          setError(result.error);
        }
      } catch (err) {
        console.warn('[app-upload] parse threw:', err);
        setError(
          err instanceof Error
            ? err.message
            : t('upload.unexpectedError', {
                defaultValue: 'An unexpected error occurred',
              }),
        );
      } finally {
        setIsParsing(false);
      }
    },
    [onBundleParsed, t],
  );

  const handleFilesSelected = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      // A folder dropped (not picked) on Chromium reports zero size + empty
      // type. Drag-drop can't reliably read a folder's contents — steer the
      // user to the dedicated folder picker.
      if (files.some((f) => f.size === 0 && f.type === '')) {
        setError(
          t('upload.useFolderButton', {
            defaultValue:
              'To upload a folder, use the “Select folder” button below.',
          }),
        );
        return;
      }
      if (files.length > 1) {
        setError(
          t('upload.singleZipOnly', {
            defaultValue: 'Drop a single .zip bundle, not multiple files.',
          }),
        );
        return;
      }
      const zip = files.find((f) => f.name.toLowerCase().endsWith('.zip'));
      if (!zip) {
        setError(
          t('upload.zipRequired', {
            defaultValue: 'Bundle must be a .zip file.',
          }),
        );
        return;
      }
      void runParse(() => parseAppBundle(zip));
    },
    [runParse, t],
  );

  const handleFolderSelected = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      e.target.value = '';
      if (files.length === 0) return;
      void runParse(() => parseAppFolder(files));
    },
    [runParse],
  );

  return (
    <Stack gap={4}>
      <Text variant="muted">
        {t('upload.description', {
          defaultValue:
            'Upload a private app to this organization. Provide a .zip of the app folder, or select the folder directly — its name becomes the app slug. Uploading does not install the app; you can install it afterwards.',
        })}
      </Text>

      <FileUpload.Root>
        <FileUpload.DropZone
          onFilesSelected={handleFilesSelected}
          accept=".zip"
          disabled={isParsing}
          inputId="app-bundle-upload"
          aria-label={t('upload.dropZoneLabel', {
            defaultValue: 'Upload app bundle',
          })}
          className={cn(
            'border-border hover:border-primary/50 focus-visible:border-ring relative flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 transition-colors outline-none focus-visible:border-solid',
            isParsing && 'pointer-events-none opacity-50',
          )}
        >
          <FileUpload.Overlay
            label={t('upload.dropHere', { defaultValue: 'Drop the .zip here' })}
            className="rounded-lg"
          />
          <Upload className="text-muted-foreground size-8" />
          <Stack gap={1} className="text-center">
            <Text variant="label">
              {isParsing
                ? t('upload.parsing', { defaultValue: 'Reading bundle…' })
                : t('upload.dropOrClick', {
                    defaultValue: 'Drop a .zip here or click to browse',
                  })}
            </Text>
            <Text variant="caption">
              {t('upload.acceptedFormats', {
                defaultValue: 'A folder containing app.json at its root',
              })}
            </Text>
          </Stack>
        </FileUpload.DropZone>
      </FileUpload.Root>

      <Row gap={3} align="center" justify="center">
        <span className="bg-border h-px flex-1" />
        <Text variant="caption">{t('upload.or', { defaultValue: 'or' })}</Text>
        <span className="bg-border h-px flex-1" />
      </Row>

      <Row justify="center">
        <Button
          type="button"
          variant="secondary"
          disabled={isParsing}
          onClick={() => folderInputRef.current?.click()}
        >
          <FolderUp className="size-4" />
          {t('upload.selectFolder', { defaultValue: 'Select folder' })}
        </Button>
        <input
          ref={folderInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFolderSelected}
          disabled={isParsing}
          aria-hidden="true"
          tabIndex={-1}
        />
      </Row>

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
