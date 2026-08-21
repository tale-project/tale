'use client';

import { Button } from '@tale/ui/button';
import { IconButton } from '@tale/ui/icon-button';
import { Input } from '@tale/ui/input';
import { HStack, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  Trash2,
  Upload,
} from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';

import {
  iconForPath,
  TreeRowButton,
  treeNavigationKeyDown,
} from '@/app/components/ui/data-display/file-tree-primitives';
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
import { extractErrorCode } from '@/app/features/shared/lib/extract-error-code';
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
 * a collapsible tree of the panel root's subtree (folders, plus files
 * matching the declaration's `match` pattern) on the shared file-tree
 * primitives, with the project Files tab's semantics: folders are collapsed
 * by default, and clicking one expands it AND picks it as the upload target
 * (clicking the picked folder again collapses and clears it). The operator
 * can create subfolders, and uploads go straight into the picked folder
 * (the whole chain is created on first use). Uploads apply immediately — no
 * Save, no dirty state — so the panel manages its own toasts. Everything
 * here is driven by the declaration (folder, subdir, accept, match);
 * nothing is specific to any one automation.
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
  const { t: tDocuments } = useT('documents');
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
  // Expanded folder ids — collapsed by default, like the project Files tab.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const treeRef = useRef<HTMLUListElement | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);

  const toggleDir = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

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

  // The panel root's whole SUBTREE, shaped for a collapsible tree: folder
  // rows grouped by their display parent ('' = the panel root's own level)
  // and matching files grouped by their folder. With a declared subdir the
  // panel is STRICTLY that subtree — files sitting directly in the settings
  // folder (the desk's own history seeds, roll-ups, policy files) are the
  // automation's records, not operator uploads: listing them here read as
  // misfiled files and offered a delete on records the runs depend on. They
  // stay visible and manageable in Knowledge.
  const { dirs, childDirs, filesIn, fileCount } = useMemo(() => {
    type DirRow = { id: string; path: string; name: string; parentKey: string };
    type FileRow = { doc: (typeof documents)[number]; displayPath: string };
    const dirRows: DirRow[] = [];
    const childDirRows = new Map<string, DirRow[]>();
    const fileRows = new Map<string, FileRow[]>();
    // Subdir declared but not created yet → an empty listing (the first
    // upload's `ensureRoot` creates the chain), never a fallback to the
    // whole settings folder.
    const root = form.subdir ? panelRoot : settingsFolder;
    if (root === undefined || matcher === null)
      return {
        dirs: dirRows,
        childDirs: childDirRows,
        filesIn: fileRows,
        fileCount: 0,
      };
    const childrenOf = new Map<string, typeof folders>();
    for (const entry of folders) {
      const key = String(entry.parentId ?? '');
      const list = childrenOf.get(key) ?? [];
      list.push(entry);
      childrenOf.set(key, list);
    }
    const prefixOf = new Map<string, string>([[String(root._id), '']]);
    const queue: Array<{ folder: typeof root; key: string }> = [
      { folder: root, key: '' },
    ];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      const prefix = prefixOf.get(String(current.folder._id)) ?? '';
      for (const child of childrenOf.get(String(current.folder._id)) ?? []) {
        // Visited guard (`prefixOf` doubles as the set): corrupt parentId
        // data must terminate, mirroring folderSubtreeIds' cycle posture.
        if (prefixOf.has(String(child._id))) continue;
        const childPath = `${prefix}${child.name}`;
        prefixOf.set(String(child._id), `${childPath}/`);
        const row: DirRow = {
          id: String(child._id),
          path: childPath,
          name: child.name,
          parentKey: current.key,
        };
        dirRows.push(row);
        const siblings = childDirRows.get(current.key) ?? [];
        siblings.push(row);
        childDirRows.set(current.key, siblings);
        queue.push({ folder: child, key: row.id });
      }
    }
    let count = 0;
    for (const doc of documents) {
      if (doc.folderId === undefined) continue;
      const folderId = String(doc.folderId);
      if (!prefixOf.has(folderId) || !matcher.test(doc.title ?? '')) continue;
      // Files directly in the panel root render at its top level; everything
      // else nests under its folder row.
      const key = folderId === String(root._id) ? '' : folderId;
      const list = fileRows.get(key) ?? [];
      list.push({
        doc,
        displayPath: `${prefixOf.get(folderId) ?? ''}${doc.title ?? ''}`,
      });
      fileRows.set(key, list);
      count++;
    }
    for (const list of fileRows.values()) {
      list.sort((a, b) => a.displayPath.localeCompare(b.displayPath));
    }
    for (const list of childDirRows.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    dirRows.sort((a, b) => a.path.localeCompare(b.path));
    return {
      dirs: dirRows,
      childDirs: childDirRows,
      filesIn: fileRows,
      fileCount: count,
    };
  }, [documents, folders, matcher, panelRoot, settingsFolder, form.subdir]);

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
    // Prefer the raw selection id over the dirs-derived row: right after
    // creating a folder the reactive folder list hasn't refreshed yet, and
    // falling back to the panel root would land the drop in the wrong place.
    let targetId: string | undefined =
      selectedDir?.id ?? selectedDirId ?? undefined;
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
      // The listing shows only `match`-ing files — uploading one that never
      // matches would succeed and then "vanish" from the panel. Same gate as
      // the listing, BEFORE the bytes move. A broken pattern fails open
      // (matcher null), mirroring the listing's posture.
      if (matcher !== null && !matcher.test(file.name)) {
        toast({
          title: t('settings.uploads.wrongName'),
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
          // `fileSize` (not just metadata.size) is what makes the mutation
          // write the fileMetadata row — the sibling upload lanes pass it,
          // and a panel upload without it stayed invisible to consumers that
          // resolve blobs through fileMetadata.
          fileSize: file.size,
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
      // any structure (e.g. one folder per topic) one step at a time. The raw
      // selection id covers a folder created moments ago that the reactive
      // list hasn't caught up with yet.
      const parentId = selectedDir?.id ?? selectedDirId ?? (await ensureRoot());
      const created = String(
        await createFolder({
          organizationId,
          name,
          parentId: toId<'folders'>(parentId),
          projectId,
        }),
      );
      setSelectedDirId(created);
      // The new folder must be visible (and stay visible once files land in
      // it): expand it and its parent — the panel-root id is not a tree row,
      // so adding it is inert.
      setExpanded((prev) => {
        const next = new Set(prev);
        next.add(created);
        next.add(parentId);
        return next;
      });
      setCreateOpen(false);
      setNewFolderName('');
    } catch (error) {
      console.error('[automations] settings folder create failed', error);
      // The one recoverable cause gets its specific house message (same as
      // the documents create-folder dialogs); everything else stays generic.
      const isDuplicate = extractErrorCode(error) === 'FOLDER_DUPLICATE_NAME';
      toast({
        title: isDuplicate
          ? tDocuments('folder.duplicateName')
          : t('settings.uploads.newFolderFailed'),
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

  const renderFile = (
    file: { doc: (typeof documents)[number]; displayPath: string },
    depth: number,
  ) => {
    const { doc, displayPath } = file;
    const baseName = displayPath.split('/').pop() ?? displayPath;
    const FileIcon = iconForPath(baseName);
    return (
      <li key={String(doc._id)} role="none">
        <HStack gap={1} align="center">
          <div className="min-w-0 flex-1">
            {/* Not a treeitem: nothing opens on click (the Files tab's
                non-openable rows read the same way); the delete affordance
                sits beside the row. */}
            <div
              className="text-muted-foreground flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs"
              style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
            >
              <FileIcon className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate" title={baseName}>
                {baseName}
              </span>
            </div>
          </div>
          <IconButton
            icon={Trash2}
            variant="ghost"
            size="sm"
            // Inside the settings <form>: without an explicit type this
            // submits it (Save fires) on top of the confirm.
            type="button"
            aria-label={t('settings.uploads.remove', {
              name: displayPath,
            })}
            disabled={uploading || disabled === true}
            onClick={() =>
              setConfirmDelete({ id: doc._id, title: displayPath })
            }
          />
        </HStack>
      </li>
    );
  };

  const renderDir = (
    dir: { id: string; path: string; name: string; parentKey: string },
    depth: number,
  ) => {
    const isExpanded = expanded.has(dir.id);
    const isSelected = dir.id === selectedDirId;
    const FolderIcon = isExpanded ? FolderOpen : Folder;
    const subDirs = childDirs.get(dir.id) ?? [];
    const dirFiles = filesIn.get(dir.id) ?? [];
    return (
      <li key={dir.id} role="none">
        {/* Click = pick as upload target AND expand, so the target is always
            visible; clicking the picked folder again collapses and clears it —
            the same semantics as the project Files tab. */}
        <TreeRowButton
          isActive={isSelected}
          depth={depth}
          onClick={() => {
            if (uploading || disabled === true) return;
            setSelectedDirId(isSelected ? null : dir.id);
            if (!isExpanded) toggleDir(dir.id);
            else if (isSelected) toggleDir(dir.id);
          }}
          title={dir.name}
          ariaLabel={dir.path}
          ariaExpanded={isExpanded}
          dataDirPath={dir.id}
          dataParentPath={dir.parentKey === '' ? null : dir.parentKey}
        >
          {isExpanded ? (
            <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
          )}
          <FolderIcon
            className="text-muted-foreground size-3.5 shrink-0"
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 truncate">{dir.name}</span>
        </TreeRowButton>
        {isExpanded && (subDirs.length > 0 || dirFiles.length > 0) ? (
          <ul role="group">
            {subDirs.map((sub) => renderDir(sub, depth + 1))}
            {dirFiles.map((file) => renderFile(file, depth + 1))}
          </ul>
        ) : null}
      </li>
    );
  };

  return (
    <Stack gap={3}>
      {dirs.length > 0 || fileCount > 0 ? (
        <ul
          ref={treeRef}
          role="tree"
          aria-label={t('settings.uploads.treeLabel')}
          className="flex flex-col gap-0.5"
          onKeyDown={(event) =>
            treeNavigationKeyDown(event, treeRef.current, expanded, toggleDir)
          }
        >
          {(childDirs.get('') ?? []).map((dir) => renderDir(dir, 0))}
          {(filesIn.get('') ?? []).map((file) => renderFile(file, 0))}
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
        {form.requireFolder === true && selectedDirId === null ? (
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
        description={t('settings.uploads.removeDescription', {
          name: confirmDelete?.title ?? '',
        })}
        confirmText={t('settings.uploads.removeConfirm')}
        variant="destructive"
        onConfirm={() => void handleDelete()}
      />
    </Stack>
  );
}
