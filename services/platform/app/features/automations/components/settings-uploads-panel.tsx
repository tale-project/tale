'use client';

import { Button } from '@tale/ui/button';
import { IconButton } from '@tale/ui/icon-button';
import { Input } from '@tale/ui/input';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { FileText, Folder, FolderPlus, Trash2, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { FileUpload } from '@/app/components/ui/forms/file-upload';
import {
  useCreateFolder,
  useDeleteDocument,
} from '@/app/features/documents/hooks/mutations';
import {
  useProjectDocuments,
  useProjectFolders,
} from '@/app/features/projects/hooks/queries';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';
import {
  DOCUMENT_MAX_FILE_SIZE,
  resolveFileType,
} from '@/lib/shared/file-types';
import type { SettingsUploadsForm } from '@/lib/shared/schemas/automation_settings';

/**
 * The uploads variant of a declared settings form: the operator manages the
 * automation's operator-provided documents without ever learning which
 * project folder backs them. The panel is a small folder-scoped manager —
 * it lists the panel root's whole subtree (files matching the declaration's
 * `match` pattern, plus its folders), lets the operator create subfolders
 * and pick one as the upload target, and uploads straight into the picked
 * folder (the whole chain is created on first use). Uploads apply
 * immediately — no Save, no dirty state — so the panel manages its own
 * toasts. Everything here is driven by the declaration (folder, subdir,
 * accept, match); nothing is specific to any one automation.
 */
export function SettingsUploadsPanel({
  organizationId,
  projectId,
  folder,
  form,
  disabled,
}: {
  organizationId: string;
  projectId: Id<'projects'>;
  /** Resolved settings folder name (see `resolveSettingsFolder`). */
  folder: string;
  form: SettingsUploadsForm;
  disabled?: boolean;
}) {
  const { t } = useT('automations');
  const { documents } = useProjectDocuments(projectId);
  const { folders } = useProjectFolders(projectId);
  const { mutateAsync: createFolder } = useCreateFolder();
  const { mutateAsync: deleteDocument } = useDeleteDocument();
  const { mutateAsync: generateUploadUrl } = useConvexMutation(
    api.files.mutations.generateUploadUrl,
  );
  const { mutateAsync: createDocumentFromUpload } = useConvexMutation(
    api.documents.mutations.createDocumentFromUpload,
  );
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{
    id: Id<'documents'>;
    title: string;
  } | null>(null);
  /** Upload target: a subtree folder id, or null = the panel root. */
  const [selectedDirId, setSelectedDirId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);

  const settingsFolder = folders.find(
    (entry) => entry.parentId === undefined && entry.name === folder,
  );
  // The panel's root: the declared subfolder of the settings folder when the
  // form names one (e.g. Setup/filed-returns), else the settings folder.
  const panelRoot = form.subdir
    ? folders.find(
        (entry) =>
          entry.name === form.subdir &&
          settingsFolder !== undefined &&
          String(entry.parentId ?? '') === String(settingsFolder._id),
      )
    : settingsFolder;
  const matcher = useMemo(() => {
    try {
      // Case-insensitive on purpose: file names arrive as scanners and
      // phone cameras produce them (.PDF, .JPG), and a listing that hides
      // an uploaded file over letter case reads as a lost upload.
      return new RegExp(form.match, 'i');
    } catch (error) {
      // A broken declared pattern fails OPEN: uploading still works, only
      // the listing goes quiet (mirror of the field pattern's posture).
      console.warn(
        '[automations] invalid uploads match pattern',
        form.match,
        error,
      );
      return null;
    }
  }, [form.match]);

  // The panel root's whole SUBTREE: its folders (pickable upload targets)
  // and its matching files, both with paths relative to the root. With a
  // declared subdir the settings folder's own top-level matches stay listed
  // too — files uploaded before the subdir existed must not vanish.
  const { dirs, files } = useMemo(() => {
    const root = panelRoot ?? settingsFolder;
    if (root === undefined || matcher === null)
      return { dirs: [], files: [] } as {
        dirs: Array<{ id: string; path: string }>;
        files: Array<{
          doc: (typeof documents)[number];
          displayPath: string;
        }>;
      };
    const childrenOf = new Map<string, typeof folders>();
    for (const entry of folders) {
      const key = String(entry.parentId ?? '');
      const list = childrenOf.get(key) ?? [];
      list.push(entry);
      childrenOf.set(key, list);
    }
    const prefixOf = new Map<string, string>([[String(root._id), '']]);
    const dirRows: Array<{ id: string; path: string }> = [];
    const queue = [root];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      const prefix = prefixOf.get(String(current._id)) ?? '';
      for (const child of childrenOf.get(String(current._id)) ?? []) {
        const childPath = `${prefix}${child.name}`;
        prefixOf.set(String(child._id), `${childPath}/`);
        dirRows.push({ id: String(child._id), path: childPath });
        queue.push(child);
      }
    }
    if (
      panelRoot !== undefined &&
      settingsFolder !== undefined &&
      String(panelRoot._id) !== String(settingsFolder._id) &&
      !prefixOf.has(String(settingsFolder._id))
    ) {
      prefixOf.set(String(settingsFolder._id), '');
    }
    const fileRows = documents
      .filter(
        (doc) =>
          doc.folderId !== undefined &&
          prefixOf.has(String(doc.folderId)) &&
          matcher.test(doc.title ?? ''),
      )
      .map((doc) => ({
        doc,
        displayPath: `${prefixOf.get(String(doc.folderId)) ?? ''}${doc.title ?? ''}`,
      }))
      .sort((a, b) => a.displayPath.localeCompare(b.displayPath));
    dirRows.sort((a, b) => a.path.localeCompare(b.path));
    return { dirs: dirRows, files: fileRows };
  }, [documents, folders, matcher, panelRoot, settingsFolder]);

  const selectedDir = dirs.find((dir) => dir.id === selectedDirId) ?? null;

  const acceptSet = new Set(form.accept.map((ext) => ext.toLowerCase()));

  /** The settings folder + declared subdir, created on first need. */
  const ensureRoot = async (): Promise<string> => {
    if (panelRoot !== undefined) return String(panelRoot._id);
    const settingsFolderId = settingsFolder
      ? String(settingsFolder._id)
      : String(await createFolder({ organizationId, name: folder, projectId }));
    if (!form.subdir) return settingsFolderId;
    return String(
      await createFolder({
        organizationId,
        name: form.subdir,
        parentId: toId<'folders'>(settingsFolderId),
        projectId,
      }),
    );
  };

  const handleFiles = async (files_: File[]) => {
    if (files_.length === 0 || uploading || disabled === true) return;
    setUploading(true);
    let okCount = 0;
    let targetId: string | undefined = selectedDir?.id;
    for (const file of files_) {
      const ext = file.name.includes('.')
        ? `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`
        : '';
      if (!acceptSet.has(ext)) {
        toast({
          title: t('settings.uploads.wrongType', {
            types: form.accept.join(', '),
          }),
          description: file.name,
          variant: 'destructive',
        });
        continue;
      }
      if (file.size > DOCUMENT_MAX_FILE_SIZE) {
        toast({
          title: t('settings.uploads.tooLarge', {
            max: String(DOCUMENT_MAX_FILE_SIZE / (1024 * 1024)),
          }),
          description: file.name,
          variant: 'destructive',
        });
        continue;
      }
      try {
        targetId ??= await ensureRoot();
        const resolvedType =
          resolveFileType(file.name, file.type) || 'application/octet-stream';
        const uploadUrl = await generateUploadUrl({});
        const response = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': resolvedType },
          body: file,
        });
        if (!response.ok) {
          throw new Error(`upload failed: ${response.status}`);
        }
        const uploadJson: unknown = await response.json();
        if (
          typeof uploadJson !== 'object' ||
          uploadJson === null ||
          !('storageId' in uploadJson) ||
          typeof uploadJson.storageId !== 'string'
        ) {
          throw new Error('upload response missing storageId');
        }
        await createDocumentFromUpload({
          organizationId,
          fileId: toId<'_storage'>(uploadJson.storageId),
          fileName: file.name,
          contentType: resolvedType,
          metadata: {
            size: file.size,
            sourceProvider: 'upload',
            sourceMode: 'manual',
            lastModified: file.lastModified,
          },
          teamId: undefined,
          folderId: toId<'folders'>(targetId),
          projectId,
        });
        okCount++;
      } catch (error) {
        console.error('[automations] settings upload failed', file.name, error);
        toast({
          title: t('settings.uploads.uploadFailed'),
          description: file.name,
          variant: 'destructive',
        });
      }
    }
    setUploading(false);
    if (okCount > 0) {
      toast({
        title: t('settings.uploads.uploaded', { count: String(okCount) }),
        variant: 'success',
      });
    }
  };

  const folderNameInvalid = (name: string): boolean =>
    name === '' ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('..');

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (folderNameInvalid(name) || creatingFolder) return;
    setCreatingFolder(true);
    try {
      // New folders nest under the picked folder, so the operator can grow
      // any structure (e.g. one folder per quarter) one step at a time.
      const parentId = selectedDir?.id ?? (await ensureRoot());
      const created = String(
        await createFolder({
          organizationId,
          name,
          parentId: toId<'folders'>(parentId),
          projectId,
        }),
      );
      setSelectedDirId(created);
      setCreateOpen(false);
      setNewFolderName('');
    } catch (error) {
      console.error('[automations] settings folder create failed', error);
      toast({
        title: t('settings.uploads.newFolderFailed'),
        variant: 'destructive',
      });
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleDelete = async () => {
    if (confirmDelete === null) return;
    try {
      await deleteDocument({ documentId: confirmDelete.id });
    } catch (error) {
      console.error('[automations] settings upload delete failed', error);
      toast({
        title: t('settings.uploads.removeFailed'),
        variant: 'destructive',
      });
    } finally {
      setConfirmDelete(null);
    }
  };

  return (
    <Stack gap={3}>
      {dirs.length > 0 || files.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {/* One tree, not two lists: each folder row is followed by its own
              contents, indented by depth, so a file's location reads off the
              layout instead of a path prefix. */}
          {[
            ...dirs.map((dir) => ({
              kind: 'dir' as const,
              sortKey: `${dir.path}/`,
              dir,
            })),
            ...files.map((file) => ({
              kind: 'file' as const,
              sortKey: file.displayPath,
              file,
            })),
          ]
            .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
            .map((row) => {
              const depth = row.sortKey.split('/').length - 1;
              if (row.kind === 'dir') {
                const selected = row.dir.id === selectedDirId;
                return (
                  <li
                    key={row.dir.id}
                    style={{ paddingLeft: `${(depth - 1) * 16}px` }}
                  >
                    {/* Picking a folder points the upload zone at it; picking
                        it again returns to the panel root. */}
                    <button
                      type="button"
                      aria-pressed={selected}
                      disabled={uploading || disabled === true}
                      onClick={() =>
                        setSelectedDirId((prev) =>
                          prev === row.dir.id ? null : row.dir.id,
                        )
                      }
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                        selected
                          ? 'bg-primary/10 ring-primary/40 ring-1'
                          : 'bg-muted/40 hover:bg-muted'
                      }`}
                    >
                      <Folder
                        className="text-muted-foreground size-4 shrink-0"
                        aria-hidden="true"
                      />
                      <Text
                        as="span"
                        className="min-w-0 flex-1 truncate text-sm"
                      >
                        {row.dir.path.split('/').pop()}
                      </Text>
                    </button>
                  </li>
                );
              }
              const { doc, displayPath } = row.file;
              const baseName = displayPath.split('/').pop() ?? displayPath;
              return (
                <li
                  key={String(doc._id)}
                  style={{ paddingLeft: `${depth * 16}px` }}
                  className="bg-muted/40 flex items-center gap-2 rounded-md px-2 py-1.5"
                >
                  <FileText
                    className="text-muted-foreground size-4 shrink-0"
                    aria-hidden="true"
                  />
                  <Text as="span" className="min-w-0 flex-1 truncate text-sm">
                    {baseName}
                  </Text>
                  <IconButton
                    icon={Trash2}
                    variant="ghost"
                    size="sm"
                    aria-label={t('settings.uploads.remove', {
                      name: displayPath,
                    })}
                    disabled={uploading || disabled === true}
                    onClick={() =>
                      setConfirmDelete({ id: doc._id, title: displayPath })
                    }
                  />
                </li>
              );
            })}
        </ul>
      ) : (
        <Text as="p" variant="muted" className="text-sm">
          {t('settings.uploads.empty')}
        </Text>
      )}
      <FileUpload.Root>
        {/* With `requireFolder` the drop zone appears only once a folder is
            picked — files must land in a period/topic folder, never at the
            panel root. */}
        {form.requireFolder === true && selectedDir === null ? (
          <Text as="p" variant="muted" className="text-sm">
            {t('settings.uploads.pickFolderHint')}
          </Text>
        ) : (
          <FileUpload.DropZone
            onFilesSelected={(picked) => void handleFiles(picked)}
            accept={form.accept.join(',')}
            multiple
            disabled={uploading || disabled === true}
            aria-label={t('settings.uploads.addButton')}
            className="hover:border-primary/50 relative flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border-2 border-dashed p-4 transition-colors"
          >
            <Upload
              className="text-muted-foreground size-5"
              aria-hidden="true"
            />
            <Text as="span" variant="muted" className="text-sm">
              {uploading
                ? t('settings.uploads.uploading')
                : selectedDir !== null
                  ? t('settings.uploads.addToFolder', {
                      folder: selectedDir.path,
                    })
                  : t('settings.uploads.addButton')}
            </Text>
            <FileUpload.Overlay />
          </FileUpload.DropZone>
        )}
        <div className="mt-2 flex justify-center">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={uploading || disabled === true}
            onClick={() => setCreateOpen(true)}
          >
            <FolderPlus className="size-4" aria-hidden="true" />
            {t('settings.uploads.newFolderButton')}
          </Button>
        </div>
      </FileUpload.Root>
      <FormDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setNewFolderName('');
        }}
        title={t('settings.uploads.newFolderTitle')}
        submitText={t('settings.uploads.newFolderCreate')}
        isSubmitting={creatingFolder}
        isValid={!folderNameInvalid(newFolderName.trim())}
        onSubmit={() => void handleCreateFolder()}
      >
        <Stack gap={2}>
          {selectedDir !== null && (
            <Text as="p" variant="muted" className="text-sm">
              {t('settings.uploads.newFolderParent', {
                folder: selectedDir.path,
              })}
            </Text>
          )}
          <Input
            value={newFolderName}
            onChange={(event) => setNewFolderName(event.target.value)}
            placeholder={t('settings.uploads.newFolderPlaceholder')}
            aria-label={t('settings.uploads.newFolderTitle')}
            disabled={creatingFolder}
          />
        </Stack>
      </FormDialog>
      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
        title={t('settings.uploads.removeTitle')}
        description={confirmDelete?.title ?? ''}
        confirmText={t('settings.uploads.removeConfirm')}
        variant="destructive"
        onConfirm={() => void handleDelete()}
      />
    </Stack>
  );
}
