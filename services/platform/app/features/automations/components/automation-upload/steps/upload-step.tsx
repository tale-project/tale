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
  parseAutomationBundle,
  parseAutomationFolder,
  type ParsedAutomationBundle,
  type ParseResult,
} from '../utils/parse-automation-bundle';

interface UploadStepProps {
  onBundleParsed: (bundle: ParsedAutomationBundle) => void;
}

export function UploadStep({ onBundleParsed }: UploadStepProps) {
  const { t } = useT('automations');
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
        console.warn('[automation-upload] parse threw:', err);
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
            defaultValue: 'Drop a single .zip package, not multiple files.',
          }),
        );
        return;
      }
      const zip = files.find((f) => f.name.toLowerCase().endsWith('.zip'));
      if (!zip) {
        setError(
          t('upload.zipRequired', {
            defaultValue: 'The package must be a .zip file.',
          }),
        );
        return;
      }
      void runParse(() => parseAutomationBundle(zip));
    },
    [runParse, t],
  );

  const handleFolderSelected = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      e.target.value = '';
      if (files.length === 0) return;
      void runParse(() => parseAutomationFolder(files));
    },
    [runParse],
  );

  return (
    <Stack gap={4}>
      <Text variant="muted">
        {t('upload.description', {
          defaultValue:
            'Upload a private automation to this organization as a .zip package, or select the automation folder directly — its name becomes the automation slug. Uploading does not install the automation; you can install it afterwards.',
        })}
      </Text>

      <FileUpload.Root>
        <FileUpload.DropZone
          onFilesSelected={handleFilesSelected}
          accept=".zip"
          disabled={isParsing}
          inputId="automation-bundle-upload"
          aria-label={t('upload.dropZoneLabel', {
            defaultValue: 'Upload automation package',
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
                ? t('upload.parsing', { defaultValue: 'Reading package…' })
                : t('upload.dropOrClick', {
                    defaultValue: 'Drop a .zip here or click to browse',
                  })}
            </Text>
            <Text variant="caption">
              {t('upload.acceptedFormats', {
                defaultValue: 'A folder containing automation.json at its root',
              })}
            </Text>
          </Stack>
        </FileUpload.DropZone>
      </FileUpload.Root>

      <Row justify="center">
        <Button
          type="button"
          variant="link"
          size="sm"
          icon={FolderUp}
          disabled={isParsing}
          onClick={() => folderInputRef.current?.click()}
        >
          {t('upload.selectFolder', {
            defaultValue: 'Select a folder instead',
          })}
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
