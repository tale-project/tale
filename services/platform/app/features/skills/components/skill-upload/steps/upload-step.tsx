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
  parseSkillBundle,
  type ParsedSkillBundle,
  type ParseError,
} from '../utils/parse-skill-bundle';
import { zipFolderSelection } from '../utils/zip-folder';

interface UploadStepProps {
  onBundleParsed: (bundle: ParsedSkillBundle) => void;
  /** Which input the pane leads with (both stay available). */
  mode: 'zip' | 'folder';
}

/**
 * Pick the bundle: drop or browse a `.zip`, or pick a real folder — the
 * folder path zips client-side and re-enters the same validation, so both
 * inputs converge on one preview.
 */
export function UploadStep({ onBundleParsed, mode }: UploadStepProps) {
  const { t } = useT('skills');
  const [error, setError] = useState<ParseError | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);

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

  const parseZip = useCallback(
    async (zip: File) => {
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
        setError({
          key: 'upload.errors.invalidZip',
          params: { detail: err instanceof Error ? err.message : String(err) },
        });
      } finally {
        setIsParsing(false);
      }
    },
    [onBundleParsed],
  );

  const handleFilesSelected = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      // A folder drop on Chromium reports zero size + empty type and no
      // `.zip` extension. Flag it specifically and point at the picker —
      // the generic "must be a .zip" message leaves users confused about
      // why their working directory was rejected.
      const folderDrop = files.find((f) => f.size === 0 && f.type === '');
      if (folderDrop) {
        setError({ key: 'upload.folderDropUnsupported' });
        return;
      }
      if (files.length > 1) {
        setError({ key: 'upload.singleFileOnly' });
        return;
      }
      const zip = files.find((f) => f.name.toLowerCase().endsWith('.zip'));
      if (!zip) {
        setError({ key: 'upload.zipRequired' });
        return;
      }
      await parseZip(zip);
    },
    [parseZip],
  );

  const handleFolderPicked = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setError(null);
      setIsParsing(true);
      try {
        const zipped = await zipFolderSelection(files);
        if (!zipped.success) {
          setError(zipped.error);
          return;
        }
        setIsParsing(false);
        await parseZip(zipped.zipFile);
      } finally {
        setIsParsing(false);
      }
    },
    [parseZip],
  );

  return (
    <Stack gap={4}>
      <Text variant="muted">{t('upload.uploadDescription')}</Text>

      <FileUpload.Root>
        <FileUpload.DropZone
          onFilesSelected={(files) => void handleFilesSelected(files)}
          accept=".zip"
          disabled={isParsing}
          inputId="skill-bundle-upload"
          aria-label={t('upload.dropZoneLabel')}
          className={cn(
            'border-border hover:border-primary/50 focus-visible:border-ring relative flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 transition-colors outline-none focus-visible:border-solid',
            isParsing && 'pointer-events-none opacity-50',
          )}
        >
          <FileUpload.Overlay
            label={t('upload.dropHere')}
            className="rounded-lg"
          />
          <Upload className="text-muted-foreground size-8" />
          <Stack gap={1} className="text-center">
            <Text variant="label">
              {isParsing ? t('upload.parsing') : t('upload.dropOrClick')}
            </Text>
            <Text variant="caption">{t('upload.acceptedFormats')}</Text>
          </Stack>
        </FileUpload.DropZone>
      </FileUpload.Root>

      <Row gap={2} align="center">
        <Button
          type="button"
          variant="secondary"
          disabled={isParsing}
          autoFocus={mode === 'folder'}
          onClick={() => folderInputRef.current?.click()}
        >
          <FolderUp className="mr-1 size-4" />
          {t('upload.chooseFolder')}
        </Button>
        <Text variant="caption">{t('upload.chooseFolderHelp')}</Text>
        <input
          ref={folderInputRef}
          type="file"
          multiple
          // Non-standard folder-pick attributes; supported by every
          // Chromium/WebKit/Gecko we target, ignored (multi-file pick, which
          // the guards refuse with a clear message) elsewhere.
          {...({ webkitdirectory: '', directory: '' } as Record<
            string,
            string
          >)}
          className="hidden"
          aria-hidden
          tabIndex={-1}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            void handleFolderPicked(files);
          }}
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
          <pre className="font-sans whitespace-pre-wrap">
            {t(error.key, error.params)}
          </pre>
        </Row>
      ) : null}
    </Stack>
  );
}
