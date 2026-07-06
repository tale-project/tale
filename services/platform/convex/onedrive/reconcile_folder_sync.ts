/**
 * Reconcile Folder Sync - Pure logic for a periodic folder-sync run.
 *
 * A sync run reuses the import pipeline (`importFiles`) for adds/updates —
 * one code path for the initial "Sync import" and every run after it. This
 * module owns the two mappings around that call: the current OneDrive
 * listing → import items, and the diff that finds documents whose source
 * files disappeared.
 */

import type { ImportItem } from './import_files';
import type { FileItem } from './list_folder_contents';

export interface FolderSyncConfig {
  configId: string;
  itemId: string;
  itemName: string;
  itemPath?: string;
}

/**
 * Map a recursive folder listing to import items, as if the user had just
 * re-selected the synced folder in the dialog: paths are rooted at the
 * config's `itemPath` so the folder chain in the hub stays identical.
 */
export function buildSyncImportItems(
  config: FolderSyncConfig,
  files: FileItem[],
): ImportItem[] {
  const root = config.itemPath || config.itemName;

  return files.map((file) => ({
    id: file.id,
    name: file.name,
    size: file.size,
    relativePath: `${root}/${file.relativePath ?? file.name}`,
    isDirectlySelected: false,
    selectedParentId: config.itemId,
    selectedParentName: config.itemName,
    selectedParentPath: config.itemPath,
  }));
}

export interface SyncedDocumentRef {
  documentId: string;
  externalItemId?: string;
  syncConfigId?: string;
  sourceMode?: string;
  /** Storage id of the doc's blob, if any — a pruned doc with a blob is
   * routed through the RAG-purging delete so its vector index is dropped
   * too; a metadata-only doc is deleted directly. */
  fileId?: string;
}

/**
 * Documents to delete because their source file left the synced folder.
 * Only auto-synced documents owned by this config are eligible — manual
 * uploads and other configs' documents are never touched.
 */
export function selectDocumentsToPrune(
  configId: string,
  currentItemIds: ReadonlySet<string>,
  existingDocs: SyncedDocumentRef[],
): string[] {
  return existingDocs
    .filter(
      (doc) =>
        doc.syncConfigId === configId &&
        doc.sourceMode === 'auto' &&
        doc.externalItemId !== undefined &&
        !currentItemIds.has(doc.externalItemId),
    )
    .map((doc) => doc.documentId);
}
