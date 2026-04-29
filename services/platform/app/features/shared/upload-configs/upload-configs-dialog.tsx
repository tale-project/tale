'use client';

import {
  AlertCircle,
  CheckCircle2,
  File as FileIcon,
  FolderUp,
  Loader2,
  Upload,
} from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import {
  type ParsedEntry,
  parseUploadedConfigs,
} from './parse-uploaded-configs';

type RowStatus = 'queued' | 'saving' | 'saved' | 'failed' | 'invalid';

interface Row extends ParsedEntry {
  status: RowStatus;
  message?: string;
}

export interface UploadConfigsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /**
   * Save a single parsed entry. Throw to mark the row as failed; the thrown
   * error's message is shown inline.
   */
  onSaveOne: (entry: ParsedEntry) => Promise<void>;
  /** Optional callback fired after a successful save so callers can refresh. */
  onAfterAllSaved?: () => void;
}

export function UploadConfigsDialog(props: UploadConfigsDialogProps) {
  if (!props.open) return null;
  return <UploadConfigsDialogContent {...props} />;
}

function UploadConfigsDialogContent({
  open,
  onOpenChange,
  title,
  description,
  onSaveOne,
  onAfterAllSaved,
}: UploadConfigsDialogProps) {
  const { t } = useT('common');
  const folderInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<Row[]>([]);
  const [isImporting, setIsImporting] = useState(false);

  const handleFilesPicked = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const parsed = await parseUploadedConfigs(files);
    setRows((current) => {
      const existing = new Set(current.map((r) => r.relPath));
      const added: Row[] = [];
      for (const entry of parsed) {
        if (existing.has(entry.relPath)) continue;
        added.push({
          relPath: entry.relPath,
          baseName: entry.baseName,
          json: entry.json,
          error: entry.error,
          status: entry.error ? 'invalid' : 'queued',
          message: entry.error,
        });
      }
      return [...current, ...added];
    });
  }, []);

  const handleFilesInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const list = e.target.files;
      if (list && list.length > 0) {
        void handleFilesPicked(Array.from(list));
      }
      e.target.value = '';
    },
    [handleFilesPicked],
  );

  const handleImport = useCallback(async () => {
    if (isImporting) return;
    const queued = rows.filter((r) => r.status === 'queued');
    if (queued.length === 0) return;

    setIsImporting(true);
    let successes = 0;
    for (const row of queued) {
      setRows((current) =>
        current.map((r) =>
          r.relPath === row.relPath
            ? { ...r, status: 'saving' as const, message: undefined }
            : r,
        ),
      );
      try {
        await onSaveOne({
          relPath: row.relPath,
          baseName: row.baseName,
          json: row.json,
        });
        successes += 1;
        setRows((current) =>
          current.map((r) =>
            r.relPath === row.relPath
              ? { ...r, status: 'saved' as const, message: undefined }
              : r,
          ),
        );
      } catch (err) {
        const message = extractErrorMessage(err);
        setRows((current) =>
          current.map((r) =>
            r.relPath === row.relPath
              ? { ...r, status: 'failed' as const, message }
              : r,
          ),
        );
      }
    }
    setIsImporting(false);
    if (successes > 0) onAfterAllSaved?.();
  }, [isImporting, rows, onSaveOne, onAfterAllSaved]);

  const handleClose = useCallback(() => {
    if (isImporting) return;
    setRows([]);
    onOpenChange(false);
  }, [isImporting, onOpenChange]);

  const queuedCount = useMemo(
    () => rows.filter((r) => r.status === 'queued').length,
    [rows],
  );
  const savedCount = useMemo(
    () => rows.filter((r) => r.status === 'saved').length,
    [rows],
  );

  const importDisabled = isImporting || queuedCount === 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose();
      }}
      title={title}
      description={description}
      size="lg"
    >
      <Stack gap={4}>
        <FileUpload.Root>
          <FileUpload.DropZone
            onFilesSelected={handleFilesPicked}
            accept=".json,.zip,application/json,application/zip"
            multiple
            inputId="upload-configs-drop"
            className="border-border hover:border-border-hover relative flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 transition-colors"
            aria-label={t('upload.dropFilesHere')}
          >
            <Upload className="text-muted-foreground size-8" />
            <Text variant="muted" className="text-center">
              {t('upload.dropFilesHere')}
            </Text>
            <Text variant="caption" className="text-center">
              {t('upload.acceptHint')}
            </Text>
          </FileUpload.DropZone>
        </FileUpload.Root>

        <HStack gap={2} className="flex-wrap">
          <Button
            type="button"
            variant="secondary"
            className="gap-2"
            onClick={() => filesInputRef.current?.click()}
            disabled={isImporting}
          >
            <FileIcon className="size-4" />
            {t('upload.pickFiles')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="gap-2"
            onClick={() => folderInputRef.current?.click()}
            disabled={isImporting}
          >
            <FolderUp className="size-4" />
            {t('upload.pickFolder')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="gap-2"
            onClick={() => zipInputRef.current?.click()}
            disabled={isImporting}
          >
            <Upload className="size-4" />
            {t('upload.pickZip')}
          </Button>
        </HStack>

        {/* Hidden inputs sized via ref so we can trigger native pickers per mode */}
        <input
          ref={filesInputRef}
          type="file"
          accept=".json,application/json"
          multiple
          className="hidden"
          onChange={handleFilesInputChange}
        />
        <input
          ref={folderInputRef}
          type="file"
          // The webkitdirectory attribute is non-standard but supported in
          // Chromium, Safari, and recent Firefox; fall through to the file
          // picker on browsers that ignore it.
          {...({ webkitdirectory: '', directory: '' } as Record<
            string,
            string
          >)}
          multiple
          className="hidden"
          onChange={handleFilesInputChange}
        />
        <input
          ref={zipInputRef}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          onChange={handleFilesInputChange}
        />

        {rows.length > 0 && (
          <div className="border-border max-h-[40vh] overflow-y-auto rounded-md border">
            <ul className="divide-border divide-y">
              {rows.map((row) => (
                <li
                  key={row.relPath}
                  className="flex items-center gap-3 px-3 py-2"
                >
                  <RowStatusIcon status={row.status} />
                  <div className="min-w-0 flex-1">
                    <Text className="truncate font-medium">{row.relPath}</Text>
                    {row.message && (
                      <Text
                        variant={
                          row.status === 'failed' || row.status === 'invalid'
                            ? 'error'
                            : 'muted'
                        }
                        className="truncate text-xs"
                      >
                        {row.message}
                      </Text>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Text variant="caption" className={cn(rows.length === 0 && 'hidden')}>
            {t('upload.summary', {
              total: rows.length,
              saved: savedCount,
              queued: queuedCount,
            })}
          </Text>
          <HStack gap={2} className="sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={handleClose}
              disabled={isImporting}
            >
              {t('actions.close')}
            </Button>
            <Button
              type="button"
              onClick={handleImport}
              disabled={importDisabled}
            >
              {isImporting ? t('actions.importing') : t('actions.import')}
            </Button>
          </HStack>
        </div>
      </Stack>
    </Dialog>
  );
}

function RowStatusIcon({ status }: { status: RowStatus }) {
  if (status === 'saving') {
    return (
      <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" />
    );
  }
  if (status === 'saved') {
    return <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />;
  }
  if (status === 'failed' || status === 'invalid') {
    return <AlertCircle className="text-destructive size-4 shrink-0" />;
  }
  return <FileIcon className="text-muted-foreground size-4 shrink-0" />;
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const data = (err as { data?: { message?: string } }).data;
    if (data?.message) return data.message;
  }
  return 'Unknown error';
}
