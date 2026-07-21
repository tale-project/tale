'use client';

/**
 * The INPUT section of an expanded subject row — the files the row's run
 * consumes, read live from the bound project folder, with in-place upload.
 * Same card chrome as the operator Outcome strip (its peer section). The
 * body starts open while the folder is empty (the next step IS uploading)
 * and collapsed once files exist; a manual toggle always wins.
 */
import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { IconButton } from '@tale/ui/icon-button';
import { Row, VStack } from '@tale/ui/layout';
import { SkeletonText } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { ChevronRightIcon, FolderInput, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { DocumentPreviewDialog } from '@/app/features/documents/components/document-preview-dialog';
import {
  useDeleteDocument,
  useDocumentUpload,
} from '@/app/features/documents/hooks/mutations';
import { useProjectDocuments } from '@/app/features/projects/hooks/queries';
import type { Id } from '@/convex/_generated/dataModel';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';

import { useAutomationRuntimeOptional } from '../../runtime/automation-runtime';

const MAX_LISTED = 8;

export function FolderUploadCard({
  folderId,
  orphaned = false,
  organizationId: organizationIdProp,
  projectId: projectIdProp,
}: {
  folderId: string;
  /** The bound folder was deleted — show a recover/remove notice instead of
   *  the upload zone (uploading to a dead folder can only fail). */
  orphaned?: boolean;
  /** Outside an automation runtime (the task modal's folder-input surface)
   *  the host passes both ids explicitly; inside a runtime they come from
   *  context as before. */
  organizationId?: string;
  projectId?: string;
}) {
  const { t } = useT('automations');
  const runtime = useAutomationRuntimeOptional();
  const organizationId = organizationIdProp ?? runtime?.organizationId;
  const projectId = projectIdProp ?? runtime?.projectId;
  if (!organizationId) {
    throw new Error(
      'FolderUploadCard needs an organizationId (prop or AutomationRuntimeProvider)',
    );
  }
  const inputRef = useRef<HTMLInputElement | null>(null);
  // null = follow the data (open while empty); a manual toggle pins it.
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);
  // The list shows the first MAX_LISTED files; "+N more" expands to every
  // file, and collapses back.
  const [showAll, setShowAll] = useState(false);

  // Project documents (the hub listing deliberately excludes them), narrowed
  // to this folder client-side — the project list is the reactive source the
  // Files tab itself uses.
  const { documents, isLoading: docsLoading } = useProjectDocuments(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- runtime carries the bound project's Convex id
    projectId as Id<'projects'> | undefined,
  );
  const docs = docsLoading
    ? undefined
    : documents.filter((doc) => doc.folderId === folderId);
  const loaded = docs !== undefined;

  const {
    stageFiles,
    uploadFiles,
    trackedFiles,
    removeTrackedFile,
    isUploading,
  } = useDocumentUpload({ organizationId });
  const { mutate: deleteDocument } = useDeleteDocument();
  const [dragActive, setDragActive] = useState(false);
  const [preview, setPreview] = useState<{
    documentId: string;
    fileName: string;
  } | null>(null);

  const open = openOverride ?? (loaded && docs.length === 0);
  const count = docs?.length ?? 0;

  // One gesture, no second confirm: staged files upload as soon as the
  // staging setState lands. Calling uploadFiles synchronously after
  // stageFiles would read the still-empty tracked list (stale closure), so
  // the trigger is this effect over the committed pending set.
  const hasPending = trackedFiles.some((f) => f.status === 'pending');
  useEffect(() => {
    if (hasPending && !isUploading) void uploadFiles({ folderId, projectId });
  }, [hasPending, isUploading, uploadFiles, folderId, projectId]);

  // A completed upload now lives in the reactive project-documents list above,
  // so drop its transient tracked entry — otherwise the "— uploaded" line
  // lingers as a ghost duplicate of the real row. Failed entries stay so the
  // operator sees what didn't land.
  useEffect(() => {
    for (const f of trackedFiles) {
      if (f.status === 'completed') removeTrackedFile(f.id);
    }
  }, [trackedFiles, removeTrackedFile]);

  // Only in-flight/failed transfers show as transient rows; completed ones
  // are cleared above and shown by the real list.
  const activeTransfers = trackedFiles.filter((f) => f.status !== 'completed');

  const onFilesPicked = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    stageFiles(Array.from(list));
    if (inputRef.current) inputRef.current.value = '';
  };

  // Orphaned: the quarter folder was deleted. Uploading here can only fail
  // (the folder is gone), so show a notice instead of the upload zone — the
  // operator recreates the folder in Knowledge or removes the return.
  if (orphaned) {
    return (
      <Card asChild padding="none" shadow="sm">
        <section>
          <Row gap={3} align="center" className="p-5 pb-3">
            <Row
              gap={0}
              justify="center"
              className="bg-muted text-muted-foreground size-8 shrink-0 rounded-md"
            >
              <FolderInput className="size-4" aria-hidden />
            </Row>
            <Text as="span" className="font-semibold">
              {t('input.title')}
            </Text>
          </Row>
          <div className="px-5 pb-5">
            <Text variant="muted">{t('input.folderDeleted')}</Text>
          </div>
        </section>
      </Card>
    );
  }

  return (
    <>
      <Card asChild padding="none" shadow="sm">
        <section>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpenOverride(!open)}
            className="flex w-full items-center gap-2.5 p-5 pb-3 text-left"
          >
            <Row
              gap={0}
              justify="center"
              className="bg-muted text-muted-foreground size-8 shrink-0 rounded-md"
            >
              <FolderInput className="size-4" aria-hidden />
            </Row>
            <Text as="span" className="font-semibold">
              {t('input.title')} {loaded ? `(${count})` : ''}
            </Text>
            <ChevronRightIcon
              className={`text-muted-foreground ml-auto size-4 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
              aria-hidden
            />
          </button>
          {open && (
            <VStack
              gap={3}
              className={`px-5 pb-5 ${dragActive ? 'bg-muted/50' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                onFilesPicked(e.dataTransfer.files);
              }}
            >
              {!loaded && <SkeletonText lines={2} />}
              {loaded && count === 0 && activeTransfers.length === 0 && (
                <Text variant="muted">{t('input.empty')}</Text>
              )}
              {loaded && count > 0 && (
                <ul className="flex flex-col gap-0.5">
                  {(showAll ? docs : docs.slice(0, MAX_LISTED)).map((doc) => (
                    <li
                      key={doc._id}
                      className="group hover:bg-muted/50 flex items-center gap-2 rounded-md px-2 py-1"
                    >
                      {/* Click-to-preview — the same DocumentPreviewDialog the
                        Knowledge tab uses (preview first, download inside). */}
                      <button
                        type="button"
                        className="focus-visible:ring-primary min-w-0 flex-1 truncate rounded-sm text-left text-sm hover:underline focus-visible:ring-2 focus-visible:outline-none"
                        onClick={() =>
                          setPreview({
                            documentId: doc._id,
                            fileName: doc.title ?? doc._id,
                          })
                        }
                      >
                        {doc.title ?? doc._id}
                      </button>
                      <IconButton
                        icon={Trash2}
                        size="sm"
                        variant="ghost"
                        aria-label={t('input.deleteFile', {
                          name: doc.title ?? doc._id,
                        })}
                        className="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                        onClick={() =>
                          deleteDocument({
                            documentId: toId<'documents'>(doc._id),
                          })
                        }
                      />
                    </li>
                  ))}
                  {count > MAX_LISTED && (
                    <li>
                      <button
                        type="button"
                        aria-expanded={showAll}
                        onClick={() => setShowAll((v) => !v)}
                        className="focus-visible:ring-primary text-muted-foreground rounded-sm px-2 py-1 text-left text-sm hover:underline focus-visible:ring-2 focus-visible:outline-none"
                      >
                        {showAll
                          ? t('input.showLess')
                          : t('input.more', { count: count - MAX_LISTED })}
                      </button>
                    </li>
                  )}
                </ul>
              )}
              {activeTransfers.length > 0 && (
                <ul className="flex flex-col gap-1" role="status">
                  {activeTransfers.map((f) => (
                    <li key={f.id}>
                      <Text variant="muted" className="text-sm">
                        {f.file.name} —{' '}
                        {f.status === 'failed'
                          ? (f.error ?? t('input.uploadFailed'))
                          : t('input.uploading')}
                      </Text>
                    </li>
                  ))}
                </ul>
              )}
              <div
                className={`flex items-center gap-3 rounded-lg border border-dashed p-3 ${
                  dragActive ? 'border-primary' : 'border-border'
                }`}
              >
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => onFilesPicked(e.target.files)}
                />
                <Text variant="muted" className="text-sm">
                  {t('input.drop')}
                </Text>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={isUploading}
                  onClick={() => inputRef.current?.click()}
                >
                  {t('input.upload')}
                </Button>
              </div>
            </VStack>
          )}
        </section>
      </Card>
      <DocumentPreviewDialog
        open={preview !== null}
        onOpenChange={(o) => {
          if (!o) setPreview(null);
        }}
        documentId={preview?.documentId}
        fileName={preview?.fileName}
      />
    </>
  );
}
