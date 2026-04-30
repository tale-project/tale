'use client';

import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  File as FileIcon,
  FolderUp,
  Loader2,
  Upload,
} from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
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

type RowStatus =
  | 'queued'
  | 'queued-overwrite'
  | 'saving'
  | 'saved'
  | 'skipped'
  | 'failed'
  | 'invalid';

interface Row extends ParsedEntry {
  status: RowStatus;
  message?: string;
  conflicts: boolean;
}

export interface UploadConfigsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /**
   * Set of identifiers (slugs / agent names) that already exist on disk.
   * Used to mark colliding uploads so the user can decide whether to
   * overwrite. Defaults to an empty set.
   */
  existingKeys?: ReadonlySet<string>;
  /**
   * Map a parsed entry to the identifier that determines collision against
   * `existingKeys`. Defaults to `entry.relPath` minus `.json`.
   */
  getKey?: (entry: ParsedEntry) => string;
  /**
   * Save a single parsed entry. Throw to mark the row as failed; the thrown
   * error's message is shown inline. The second argument tells the callback
   * whether the row was queued explicitly as an overwrite of an existing
   * entry — useful for actions whose semantics depend on the distinction
   * (e.g. agents pass `isNew: !overwrite`).
   */
  onSaveOne: (
    entry: ParsedEntry,
    opts: { overwrite: boolean },
  ) => Promise<void>;
  /** Optional callback fired after a successful save so callers can refresh. */
  onAfterAllSaved?: () => void;
}

const defaultGetKey = (entry: ParsedEntry) =>
  entry.relPath.replace(/\.json$/i, '');

export function UploadConfigsDialog(props: UploadConfigsDialogProps) {
  if (!props.open) return null;
  return <UploadConfigsDialogContent {...props} />;
}

function UploadConfigsDialogContent({
  open,
  onOpenChange,
  title,
  description,
  existingKeys,
  getKey = defaultGetKey,
  onSaveOne,
  onAfterAllSaved,
}: UploadConfigsDialogProps) {
  const { t } = useT('common');
  const folderInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<Row[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  // Default to overwrite: when files exist, the user almost always intends
  // to update them in-place. Backends are non-destructive (history is
  // preserved on overwrite); the warning banner still surfaces the action so
  // users can opt out per-upload by unchecking the toggle.
  const [overwriteConflicts, setOverwriteConflicts] = useState(true);

  const handleFilesPicked = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const parsed = await parseUploadedConfigs(files);
      setRows((current) => {
        const existing = new Set(current.map((r) => r.relPath));
        const added: Row[] = [];
        for (const entry of parsed) {
          if (existing.has(entry.relPath)) continue;
          const key = getKey(entry);
          const conflicts = !entry.error && !!existingKeys?.has(key);
          added.push({
            relPath: entry.relPath,
            baseName: entry.baseName,
            json: entry.json,
            error: entry.error,
            conflicts,
            status: entry.error ? 'invalid' : 'queued',
            message: entry.error,
          });
        }
        return [...current, ...added];
      });
    },
    [existingKeys, getKey],
  );

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
    const importable = rows.filter(
      (r) => r.status === 'queued' && (overwriteConflicts || !r.conflicts),
    );
    const toSkip = rows.filter(
      (r) => r.status === 'queued' && r.conflicts && !overwriteConflicts,
    );
    if (importable.length === 0 && toSkip.length === 0) return;

    setIsImporting(true);

    if (toSkip.length > 0) {
      setRows((current) =>
        current.map((r) =>
          r.status === 'queued' && r.conflicts && !overwriteConflicts
            ? { ...r, status: 'skipped' as const, message: undefined }
            : r,
        ),
      );
    }

    let successes = 0;
    for (const row of importable) {
      setRows((current) =>
        current.map((r) =>
          r.relPath === row.relPath
            ? { ...r, status: 'saving' as const, message: undefined }
            : r,
        ),
      );
      try {
        await onSaveOne(
          {
            relPath: row.relPath,
            baseName: row.baseName,
            json: row.json,
          },
          { overwrite: row.conflicts },
        );
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
  }, [isImporting, rows, overwriteConflicts, onSaveOne, onAfterAllSaved]);

  const handleClose = useCallback(() => {
    if (isImporting) return;
    setRows([]);
    setOverwriteConflicts(true);
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
  const conflictCount = useMemo(
    () => rows.filter((r) => r.status === 'queued' && r.conflicts).length,
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

        {conflictCount > 0 && (
          <div className="bg-warning/10 border-warning/40 flex items-start gap-3 rounded-md border p-3">
            <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <Text className="text-sm font-medium">
                {t('upload.conflictHeading', { count: conflictCount })}
              </Text>
              <Text variant="caption" className="mt-0.5">
                {t('upload.conflictHint')}
              </Text>
              <div className="mt-2">
                <Checkbox
                  checked={overwriteConflicts}
                  onCheckedChange={(value) =>
                    setOverwriteConflicts(value === true)
                  }
                  disabled={isImporting}
                  label={t('upload.overwriteToggle')}
                />
              </div>
            </div>
          </div>
        )}

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
                    <Text
                      variant={rowMessageVariant(row.status)}
                      className="truncate text-xs"
                    >
                      {rowMessage(row, overwriteConflicts, t) ?? ''}
                    </Text>
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
  if (status === 'skipped') {
    return <CircleSlash className="text-muted-foreground size-4 shrink-0" />;
  }
  return <FileIcon className="text-muted-foreground size-4 shrink-0" />;
}

function rowMessageVariant(status: RowStatus): 'error' | 'muted' | 'caption' {
  if (status === 'failed' || status === 'invalid') return 'error';
  if (status === 'skipped') return 'caption';
  return 'muted';
}

function rowMessage(
  row: Row,
  overwriteConflicts: boolean,
  t: (key: string) => string,
): string | undefined {
  if (row.message) return row.message;
  if (row.status === 'skipped') return t('upload.statusSkipped');
  if (row.status === 'queued' && row.conflicts) {
    return overwriteConflicts
      ? t('upload.willOverwrite')
      : t('upload.statusExists');
  }
  return undefined;
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
