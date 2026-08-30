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
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

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
  onBusyChange,
}: {
  organizationId: string;
  projectId: string;
  /** Resolved settings folder name (see `resolveSettingsFolder`). */
  folder: string;
  form: SettingsUploadsForm;
  disabled?: boolean;
  /** Mirrors the panel's upload-in-flight state to the mounting form, which
   * must not save (and unmount this panel) under a running upload. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const { t } = useT('automations');
  const { t: tDocuments } = useT('documents');
  const { documents, isLoading: documentsLoading } =
    useProjectDocuments(projectId);
  const { folders, isLoading: foldersLoading } = useProjectFolders(projectId);
  // While either query is loading, "no rows" means NOTHING: painting the
  // empty state would misreport, and creating folders against an unloaded
  // list would duplicate a chain that already exists server-side.
  const loading = documentsLoading || foldersLoading;
  const { mutateAsync: createFolder } = useCreateFolder();
  const { mutateAsync: deleteDocument, isPending: isDeletingDocument } =
    useDeleteDocument();
  const { mutateAsync: generateUploadUrl } = useConvexMutation(
    'files/mutations:generateUploadUrl',
  );
  const { mutateAsync: createDocumentFromUpload } = useConvexMutation(
    'documents/mutations:createDocumentFromUpload',
  );
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{
    id: string;
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
  const fileInputId = useId();
  // Folders THIS panel just created: the one legitimate window where the
  // selection may point at an id the reactive listing hasn't caught up with.
  const justCreatedRef = useRef<ReadonlySet<string>>(new Set());
  // Latest folder list for the duplicate-adoption path below — an async
  // recovery must not read a stale render's closure.
  const foldersRef = useRef(folders);
  useEffect(() => {
    foldersRef.current = folders;
  }, [folders]);

  useEffect(() => {
    onBusyChange?.(uploading);
  }, [uploading, onBusyChange]);

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
          (entry.parentId ?? '') === settingsFolder._id,
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
      const key = entry.parentId ?? '';
      const list = childrenOf.get(key) ?? [];
      list.push(entry);
      childrenOf.set(key, list);
    }
    const prefixOf = new Map<string, string>([[root._id, '']]);
    const queue: Array<{ folder: typeof root; key: string }> = [
      { folder: root, key: '' },
    ];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      const prefix = prefixOf.get(current.folder._id) ?? '';
      for (const child of childrenOf.get(current.folder._id) ?? []) {
        // Visited guard (`prefixOf` doubles as the set): corrupt parentId
        // data must terminate, mirroring folderSubtreeIds' cycle posture.
        if (prefixOf.has(child._id)) continue;
        const childPath = `${prefix}${child.name}`;
        prefixOf.set(child._id, `${childPath}/`);
        const row: DirRow = {
          id: child._id,
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
      const folderId = doc.folderId;
      if (!prefixOf.has(folderId) || !matcher.test(doc.title ?? '')) continue;
      // Files directly in the panel root render at its top level; everything
      // else nests under its folder row.
      const key = folderId === root._id ? '' : folderId;
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

  // Reconcile the pick against the live subtree: a folder deleted (or moved
  // out) elsewhere must not stay the invisible upload target behind a
  // "no pick" UI. A folder this panel just created is the one legitimate
  // not-listed-yet pick — it keeps the selection through the refresh window.
  const dirIds = useMemo(() => new Set(dirs.map((dir) => dir.id)), [dirs]);
  useEffect(() => {
    if (loading || selectedDirId === null) return;
    if (dirIds.has(selectedDirId)) {
      if (justCreatedRef.current.has(selectedDirId)) {
        const next = new Set(justCreatedRef.current);
        next.delete(selectedDirId);
        justCreatedRef.current = next;
      }
      return;
    }
    if (justCreatedRef.current.has(selectedDirId)) return;
    setSelectedDirId(null);
  }, [dirIds, selectedDirId, loading]);

  const acceptSet = new Set(form.accept.map((ext) => ext.toLowerCase()));

  /** Create one folder, or adopt it when it already exists: the reactive
   * folder list lags the server, and the settings SAVE path creates the same
   * settings folder through its own get-or-create — racing it must not fail
   * the upload with a duplicate-name error. */
  const createOrAdopt = async (
    name: string,
    parentId?: string,
  ): Promise<string> => {
    try {
      return await createFolder({
        organizationId,
        name,
        ...(parentId !== undefined && {
          parentId: parentId,
        }),
        projectId,
      });
    } catch (error) {
      if (extractErrorCode(error) === 'FOLDER_DUPLICATE_NAME') {
        const existing = foldersRef.current.find(
          (entry) =>
            entry.name === name && (entry.parentId ?? '') === (parentId ?? ''),
        );
        if (existing !== undefined) return existing._id;
      }
      throw error;
    }
  };

  // Single-flight + created-id memory: `createFolder` is not idempotent, and
  // ensureRoot has two callers (drop, New folder) that can both run before
  // the reactive list shows the chain they created.
  const ensureRootRef = useRef<Promise<string> | null>(null);
  const createdRootRef = useRef<string | null>(null);

  /** The settings folder + declared subdir, created on first need. */
  const ensureRoot = (): Promise<string> => {
    if (panelRoot !== undefined) return Promise.resolve(panelRoot._id);
    if (createdRootRef.current !== null)
      return Promise.resolve(createdRootRef.current);
    ensureRootRef.current ??= (async () => {
      const settingsFolderId = settingsFolder
        ? settingsFolder._id
        : await createOrAdopt(folder);
      const rootId = form.subdir
        ? await createOrAdopt(form.subdir, settingsFolderId)
        : settingsFolderId;
      createdRootRef.current = rootId;
      return rootId;
    })().catch((error: unknown) => {
      // A failed attempt must not poison later ones.
      ensureRootRef.current = null;
      throw error;
    });
    return ensureRootRef.current;
  };

  const handleFiles = async (files_: File[]) => {
    if (files_.length === 0 || uploading || disabled === true || loading)
      return;
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
          fileId: uploadJson.storageId,
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
          folderId: targetId,
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
    if (folderNameInvalid(name) || creatingFolder || loading) return;
    setCreatingFolder(true);
    try {
      // New folders nest under the picked folder, so the operator can grow
      // any structure (e.g. one folder per topic) one step at a time. The raw
      // selection id covers a folder created moments ago that the reactive
      // list hasn't caught up with yet.
      const parentId = selectedDir?.id ?? selectedDirId ?? (await ensureRoot());
      const created = await createFolder({
        organizationId,
        name,
        parentId: parentId,
        projectId,
      });
      // Provisional until the reactive listing shows it — keeps the pick
      // (and the reconciliation effect) honest through the refresh window.
      justCreatedRef.current = new Set([...justCreatedRef.current, created]);
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
    if (confirmDelete === null || isDeletingDocument) return;
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

  // Roving tabindex: exactly one row carries the tab stop. The picked folder
  // when there is one; otherwise the FIRST rendered row — without a fallback
  // Tab skips the tree entirely, and with `requireFolder` a keyboard user
  // could never pick the folder the form demands.
  const rootDirRows = childDirs.get('') ?? [];
  const rootFileRows = filesIn.get('') ?? [];
  const hasValidPick = selectedDirId !== null && dirIds.has(selectedDirId);
  const firstRowKey =
    rootDirRows[0]?.id ??
    (rootFileRows[0] !== undefined ? rootFileRows[0].doc._id : null);
  const treeBusy = uploading || disabled === true;

  const renderFile = (
    file: { doc: (typeof documents)[number]; displayPath: string },
    depth: number,
    parentKey: string,
  ) => {
    const { doc, displayPath } = file;
    const baseName = displayPath.split('/').pop() ?? displayPath;
    const FileIcon = iconForPath(baseName);
    const rowKey = doc._id;
    return (
      <li key={rowKey} role="none">
        <HStack gap={1} align="center">
          <div className="min-w-0 flex-1">
            {/* A treeitem with no action of its own (this panel opens
                nothing): focusable so arrow navigation walks files too, but
                not a button — the delete affordance sits beside the row. */}
            <div
              role="treeitem"
              aria-level={depth + 1}
              aria-selected={false}
              tabIndex={!hasValidPick && rowKey === firstRowKey ? 0 : -1}
              data-parent-path={parentKey === '' ? undefined : parentKey}
              className="text-muted-foreground focus-visible:ring-ring flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs focus-visible:ring-1 focus-visible:outline-none"
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
            disabled={treeBusy}
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
          disabled={treeBusy}
          tabbable={hasValidPick ? isSelected : dir.id === firstRowKey}
          onClick={() => {
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
            {dirFiles.map((file) => renderFile(file, depth + 1, dir.id))}
          </ul>
        ) : null}
      </li>
    );
  };

  return (
    <Stack gap={3}>
      {loading ? (
        <Text as="p" variant="muted" className="text-sm">
          {t('settings.uploads.loading')}
        </Text>
      ) : dirs.length > 0 || fileCount > 0 ? (
        <ul
          ref={treeRef}
          role="tree"
          aria-label={t('settings.uploads.treeLabel')}
          className="flex flex-col gap-0.5"
          onKeyDown={(event) => {
            // Frozen tree freezes for the keyboard too — arrows must not
            // expand rows whose clicks are disabled.
            if (treeBusy) return;
            treeNavigationKeyDown(event, treeRef.current, expanded, toggleDir);
          }}
        >
          {rootDirRows.map((dir) => renderDir(dir, 0))}
          {rootFileRows.map((file) => renderFile(file, 0, ''))}
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
            disabled={uploading || disabled === true || loading}
            // A per-instance input id: the shared default collides when a
            // declaration carries several uploads forms on one setup page.
            inputId={fileInputId}
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
            disabled={uploading || disabled === true || loading}
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
          if (!open && !isDeletingDocument) setConfirmDelete(null);
        }}
        title={t('settings.uploads.removeTitle')}
        description={t('settings.uploads.removeDescription', {
          name: confirmDelete?.title ?? '',
        })}
        confirmText={t('settings.uploads.removeConfirm')}
        variant="destructive"
        isLoading={isDeletingDocument}
        onConfirm={() => void handleDelete()}
      />
    </Stack>
  );
}
