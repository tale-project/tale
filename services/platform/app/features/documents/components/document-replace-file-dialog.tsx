'use client';

import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { CircleAlert, FileUp } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type RefObject,
} from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { useUploadPolicy } from '@/app/features/settings/governance/hooks/queries';
import { useFormatNumber } from '@/app/hooks/use-format-number';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  DOCUMENT_UPLOAD_ACCEPT,
  extractExtension,
  isRagIndexableFile,
  resolveFileType,
} from '@/lib/shared/file-types';
import { cn } from '@/lib/utils/cn';
import { formatBytes } from '@/lib/utils/format/number';
import type { DocumentRecordInfo } from '@/types/documents';

import {
  useDocumentUpload,
  type DocumentUploadSuccess,
} from '../hooks/mutations';
import { useUploadUsage } from '../hooks/queries';
import {
  documentUploadAccept,
  documentUploadMaxFileSize,
  documentUploadSelectionIssueMessage,
  validateDocumentUploadSelection,
} from '../lib/document-upload-selection';
import { UploadFileRow } from './upload-file-row';

interface DocumentReplaceFileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  documentId: string;
  documentName?: string | null;
  documentMimeType?: string;
  documentExtension?: string;
  recordVersion: number;
  expectedFileId: string;
  recordState?: DocumentRecordInfo['state'];
  restoreFocusRef?: RefObject<HTMLElement | null>;
}

function DocumentReplaceFileDialogContent({
  open,
  onOpenChange,
  organizationId,
  documentId,
  documentName,
  documentMimeType,
  documentExtension,
  recordVersion,
  expectedFileId,
  recordState,
  restoreFocusRef,
}: DocumentReplaceFileDialogProps) {
  const { t: tDocuments } = useT('documents');
  const { t: tCommon } = useT('common');
  const { locale, formatNumber } = useFormatNumber();
  const policyLimits = useUploadPolicy(organizationId);
  const { data: uploadUsage } = useUploadUsage(organizationId);
  // The content component mounts when the dialog opens. Keep that revision
  // and blob generation fixed so a live row update cannot silently retarget a
  // staged file after another dialog replaces the same draft.
  const [expectedTarget] = useState(() => ({
    documentId,
    version: recordVersion,
    fileId: expectedFileId,
    state: recordState,
  }));
  const expectedTargetIsReplaceable =
    expectedTarget.state === 'draft' || expectedTarget.state === 'approved';
  const targetDiverged =
    documentId !== expectedTarget.documentId ||
    recordVersion !== expectedTarget.version ||
    expectedFileId !== expectedTarget.fileId ||
    recordState !== expectedTarget.state ||
    !expectedTargetIsReplaceable;
  const [staleTargetObserved, setStaleTargetObserved] = useState(
    () => !expectedTargetIsReplaceable,
  );
  useEffect(() => {
    if (targetDiverged) setStaleTargetObserved(true);
  }, [targetDiverged]);
  // Divergence is a one-way latch for this mount. Even if a later query update
  // happens to resemble the frozen target again, the user must reopen and
  // intentionally freeze a fresh CAS target before selecting or submitting.
  const isTargetStale = targetDiverged || staleTargetObserved;
  const requiredExtension =
    documentExtension ?? extractExtension(documentName ?? undefined);
  const effectiveMaxFileSize = documentUploadMaxFileSize(policyLimits);
  const effectiveAccept = documentUploadAccept(
    policyLimits,
    DOCUMENT_UPLOAD_ACCEPT,
    requiredExtension,
    requiredExtension ? undefined : documentMimeType,
  );
  const replacementTarget = useMemo(
    () => ({
      documentId: expectedTarget.documentId,
      expectedRecordState:
        expectedTarget.state === 'approved'
          ? ('approved' as const)
          : ('draft' as const),
      expectedVersion: expectedTarget.version,
      expectedFileId: expectedTarget.fileId,
    }),
    [expectedTarget],
  );
  const isApprovedTarget = expectedTarget.state === 'approved';
  const expectedNextVersion = expectedTarget.version + 1;

  const handleSuccess = useCallback(
    (fileInfo: DocumentUploadSuccess) => {
      const authoritativeVersion =
        fileInfo.version ??
        (isApprovedTarget ? expectedNextVersion : expectedTarget.version);
      toast({
        title: isApprovedTarget
          ? tDocuments('record.replace.approvedSuccess', {
              approvedVersion: expectedTarget.version,
              version: authoritativeVersion,
            })
          : tDocuments('record.replace.success', {
              version: authoritativeVersion,
            }),
        variant: 'success',
      });
      onOpenChange(false);
    },
    [
      expectedNextVersion,
      expectedTarget.version,
      isApprovedTarget,
      onOpenChange,
      tDocuments,
    ],
  );

  const {
    stageFiles,
    uploadFiles,
    retryFile,
    isUploading,
    trackedFiles,
    clearTrackedFiles,
    cancelUpload,
    canCancelUpload,
  } = useDocumentUpload({
    organizationId,
    replacementTarget,
    onSuccess: handleSuccess,
  });

  const trackedFile = trackedFiles[0];
  const hasPendingFile = trackedFile?.status === 'pending';

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && isUploading) return;
      if (!nextOpen) clearTrackedFiles();
      onOpenChange(nextOpen);
    },
    [clearTrackedFiles, isUploading, onOpenChange],
  );

  const processFiles = useCallback(
    (files: File[]) => {
      if (isTargetStale || files.length === 0) return;
      if (files.length > 1) {
        toast({
          title: tDocuments('record.replace.oneFileOnly'),
          variant: 'destructive',
        });
        return;
      }

      const file = files[0];
      const issue = validateDocumentUploadSelection(
        file,
        policyLimits,
        requiredExtension,
        requiredExtension ? undefined : documentMimeType,
      );
      if (issue) {
        const message = documentUploadSelectionIssueMessage(
          issue,
          tDocuments,
          locale,
        );
        toast({ ...message, variant: 'destructive' });
        return;
      }
      stageFiles([file], true);
    },
    [
      documentMimeType,
      isTargetStale,
      locale,
      policyLimits,
      requiredExtension,
      stageFiles,
      tDocuments,
    ],
  );

  const handleReplace = useCallback(() => {
    if (isTargetStale || !hasPendingFile) return;
    void uploadFiles();
  }, [hasPendingFile, isTargetStale, uploadFiles]);

  const handleCancelUpload = useCallback(() => {
    if (cancelUpload()) clearTrackedFiles();
  }, [cancelUpload, clearTrackedFiles]);

  const maxSizeMb = effectiveMaxFileSize / (1024 * 1024);
  const formatLabel = requiredExtension
    ? `.${requiredExtension.toUpperCase()}`
    : tDocuments('record.replace.sameFormat');

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title={tDocuments('record.replace.title')}
      description={tDocuments(
        isApprovedTarget
          ? 'record.replace.approvedDescription'
          : 'record.replace.description',
        {
          name: documentName ?? tDocuments('entityLabelOne'),
          version: expectedTarget.version,
          nextVersion: expectedNextVersion,
        },
      )}
      restoreFocusRef={restoreFocusRef}
      size="md"
      footerClassName="px-6 pt-4 pb-5"
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            disabled={isUploading && !canCancelUpload}
            onClick={
              isUploading ? handleCancelUpload : () => handleOpenChange(false)
            }
          >
            {isUploading
              ? tDocuments('upload.cancelUpload')
              : tCommon('actions.cancel')}
          </Button>
          <Button
            type="button"
            onClick={handleReplace}
            disabled={!hasPendingFile || isUploading || isTargetStale}
          >
            {tDocuments(
              isApprovedTarget
                ? 'record.replace.approvedConfirm'
                : 'record.replace.confirm',
              { version: expectedNextVersion },
            )}
          </Button>
        </>
      }
    >
      <Stack className="min-w-0 px-6 pt-2 pb-4">
        {isTargetStale && (
          <Row
            role="alert"
            aria-atomic="true"
            gap={2}
            align="start"
            className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border px-3 py-2"
          >
            <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
            <span className="text-xs leading-relaxed">
              {tDocuments(
                isApprovedTarget
                  ? 'record.replace.approvedStaleDialog'
                  : 'record.replace.staleDialog',
              )}
            </span>
          </Row>
        )}

        <FileUpload.Root>
          <FileUpload.DropZone
            onFilesSelected={processFiles}
            accept={effectiveAccept}
            disabled={isUploading || isTargetStale}
            inputId={`document-replacement-${documentId}`}
            aria-label={tDocuments('record.replace.dropZoneAria', {
              name: documentName ?? tDocuments('entityLabelOne'),
            })}
            className={cn(
              'relative flex flex-col items-center justify-center gap-2 rounded-lg border bg-card/30 py-8 px-4 text-center cursor-pointer transition-colors',
              'hover:border-primary/40 hover:bg-muted/50',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              (isUploading || isTargetStale) && 'opacity-50 cursor-not-allowed',
            )}
          >
            <FileUpload.Overlay className="rounded-lg" />
            <FileUp className="text-muted-foreground size-6" />
            <span className="text-foreground text-sm font-medium">
              {tDocuments('record.replace.dropZoneTitle')}
            </span>
            <span className="text-muted-foreground text-xs">
              {tDocuments('record.replace.dropZoneDescription', {
                format: formatLabel,
                maxSize: formatNumber(maxSizeMb, {
                  maximumFractionDigits: 1,
                }),
              })}
            </span>
          </FileUpload.DropZone>
        </FileUpload.Root>

        {uploadUsage?.limited && uploadUsage.limitBytes != null && (
          <span className="text-muted-foreground px-1 text-xs">
            {tDocuments('upload.quotaUsage', {
              used: formatBytes(uploadUsage.usedBytes, locale),
              limit: formatBytes(uploadUsage.limitBytes, locale),
            })}
          </span>
        )}

        {trackedFile && (
          <UploadFileRow
            fileName={trackedFile.file.name}
            fileSize={trackedFile.file.size}
            status={trackedFile.status}
            bytesLoaded={trackedFile.bytesLoaded}
            bytesTotal={trackedFile.bytesTotal}
            error={trackedFile.error}
            notIndexable={
              !isRagIndexableFile(
                trackedFile.file.name,
                resolveFileType(trackedFile.file.name, trackedFile.file.type),
              )
            }
            onRetry={
              isUploading || isTargetStale || trackedFile.retryable === false
                ? undefined
                : () => void retryFile(trackedFile.id)
            }
            onRemove={
              trackedFile.status === 'pending' ? clearTrackedFiles : undefined
            }
          />
        )}

        <Row className="bg-muted/40 rounded-lg border px-3 py-2">
          <span className="text-muted-foreground text-xs leading-relaxed">
            {tDocuments(
              isApprovedTarget
                ? 'record.replace.approvedHistoryHint'
                : 'record.replace.historyHint',
              {
                version: expectedTarget.version,
                nextVersion: expectedNextVersion,
              },
            )}
          </span>
        </Row>
      </Stack>
    </Dialog>
  );
}

/**
 * One-file binder for a controlled draft. Mount only while open so each table
 * row does not keep upload-policy and usage subscriptions alive.
 */
export function DocumentReplaceFileDialog(
  props: DocumentReplaceFileDialogProps,
) {
  if (!props.open) return null;
  return <DocumentReplaceFileDialogContent {...props} />;
}
