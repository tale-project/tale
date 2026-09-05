'use client';

import {
  ClipboardCheck,
  FilePen,
  FileUp,
  Shield,
  UserCheck,
  UserCog,
} from 'lucide-react';
import { useCallback, useMemo, type ReactNode, type RefObject } from 'react';

import {
  useEntityRowDialogs,
  type EntityRowAction,
} from '@/app/components/ui/entity/entity-row-actions';
import { useLegalHoldByTarget } from '@/app/features/settings/governance/hooks/queries';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import type { DocumentRecordInfo } from '@/types/documents';

import { DocumentRecordReviewDialog } from '../components/document-record-review-dialog';
import { DocumentRecordSubmitDialog } from '../components/document-record-submit-dialog';
import { DocumentReplaceFileDialog } from '../components/document-replace-file-dialog';
import { useMarkDocumentControlled, useOpenRecordRevision } from './mutations';

interface UseDocumentRecordActionsOptions {
  documentId: string;
  documentName?: string | null;
  mimeType?: string;
  extension?: string;
  /** Gates "Mark as controlled" — only user/agent-authored documents can
   *  become controlled records (the server refuses sync-owned sources). */
  sourceProvider?: string;
  /** Controlled-record state — drives which lifecycle action shows. */
  record?: DocumentRecordInfo;
  /** The caller's document-write permission for THIS row — org
   *  `knowledgeWrite` on hub rows, `project.canEdit` on project rows; the
   *  server re-enforces the real rule either way. */
  canWrite: boolean;
  /** False for folder rows — records are a file-level concept. */
  enabled: boolean;
  /** Stable focus target for dialogs opened from an unmounting menu item. */
  restoreFocusRef?: RefObject<HTMLButtonElement | null>;
}

interface UseDocumentRecordActionsResult {
  /** The record lifecycle menu entries, in lifecycle order — splice into an
   *  `EntityRowActions` list. */
  actions: EntityRowAction[];
  /** The dialogs those actions open; render once next to the menu. */
  dialogs: ReactNode;
  /** An active legal hold on this document (also blocks replace/delete). */
  isHeld: boolean;
  /** in_review/approved — content is frozen; trash/delete refuse server-side. */
  isRecordProtected: boolean;
}

/**
 * The controlled-record lifecycle for one document row — mark as controlled,
 * replace file, submit for review, review, change reviewer, open next
 * revision — as row-menu
 * actions plus the dialogs they open (convex/documents/records.ts). Shared by
 * the Knowledge Hub documents table and the project Files tab so the state
 * machine has exactly one UI wiring; only the permission gate differs per
 * caller (`canWrite`).
 */
export function useDocumentRecordActions({
  documentId,
  documentName,
  mimeType,
  extension,
  sourceProvider,
  record,
  canWrite,
  enabled,
  restoreFocusRef,
}: UseDocumentRecordActionsOptions): UseDocumentRecordActionsResult {
  const { t: tDocuments } = useT('documents');
  const organizationId = useOrganizationId();
  const dialogs = useEntityRowDialogs([
    'recordReplace',
    'recordSubmit',
    'recordReassign',
    'recordReview',
  ]);
  const { mutateAsync: markControlled, isPending: isMarkingControlled } =
    useMarkDocumentControlled();
  const { mutateAsync: openRevision, isPending: isOpeningRevision } =
    useOpenRecordRevision();
  // Read-only consultation so replace (and the caller's delete) can show
  // "blocked by legal hold". Holds are placed/released exclusively from the
  // governance panel. Cascade-includes user-custodian hits via the document
  // author.
  const { data: legalHold } = useLegalHoldByTarget({
    organizationId: organizationId ?? undefined,
    targetType: 'document',
    targetId: enabled ? documentId : undefined,
  });
  const isHeld = legalHold !== null && legalHold !== undefined;

  const handleMarkControlled = useCallback(async () => {
    if (isMarkingControlled) return;
    try {
      await markControlled({ documentId: documentId });
      toast({
        title: tDocuments('record.toast.controlled'),
        variant: 'success',
      });
    } catch (error) {
      console.error('[documents] mark controlled failed', error);
      toast({
        title: tDocuments('record.toast.controlledFailed'),
        variant: 'destructive',
      });
    }
  }, [documentId, markControlled, isMarkingControlled, tDocuments]);

  const handleOpenRevision = useCallback(async () => {
    if (isOpeningRevision) return;
    try {
      const result = await openRevision({
        documentId: documentId,
      });
      toast({
        title: tDocuments('record.toast.revisionOpened', {
          version: result.version,
        }),
        variant: 'success',
      });
    } catch (error) {
      console.error('[documents] open record revision failed', error);
      toast({
        title: tDocuments('record.toast.revisionFailed'),
        variant: 'destructive',
      });
    }
  }, [documentId, openRevision, isOpeningRevision, tDocuments]);

  // The server refuses connector/sync-owned sources; hide the entry point
  // for them (an absent provider reads as 'upload', matching the server).
  const canBecomeControlled =
    sourceProvider === undefined ||
    sourceProvider === 'upload' ||
    sourceProvider === 'agent';
  // Mirrors the server's `recordTrashRefusal` (documents/access.ts): a
  // frozen record (in_review/approved) refuses trash/delete, and so does a
  // draft that retains an approved version in history — callers surface it
  // like the legal-hold gate instead of a failing action.
  const isRecordProtected =
    record?.state === 'in_review' ||
    record?.state === 'approved' ||
    record?.hasApprovedVersions === true;

  const actions = useMemo<EntityRowAction[]>(
    () => [
      {
        key: 'markControlled',
        label: tDocuments('record.actions.markControlled'),
        icon: Shield,
        onClick: handleMarkControlled,
        visible:
          canWrite && enabled && record === undefined && canBecomeControlled,
        disabled: isMarkingControlled,
      },
      {
        key: 'recordReplace',
        label: isHeld
          ? tDocuments('record.replace.blockedByHold')
          : tDocuments('record.actions.replaceFile'),
        icon: FileUp,
        onClick: dialogs.open.recordReplace,
        visible:
          canWrite &&
          enabled &&
          (record?.state === 'draft' || record?.state === 'approved'),
        disabled: isHeld || record?.currentFileId === undefined,
      },
      {
        key: 'recordSubmit',
        label: tDocuments('record.actions.submitForReview'),
        icon: UserCheck,
        onClick: dialogs.open.recordSubmit,
        visible: canWrite && enabled && record?.state === 'draft',
      },
      {
        key: 'recordReview',
        label: tDocuments('record.actions.review'),
        icon: ClipboardCheck,
        onClick: dialogs.open.recordReview,
        visible: canWrite && enabled && record?.state === 'in_review',
      },
      // The stuck-review exit: while in review, any writer can re-designate
      // the reviewer (the server supersedes the standing request). Without
      // this door a designee who left the org, was disabled or lost the
      // document's scope froze the record for good — every other in_review
      // action is the designee's alone or refuses the state.
      {
        key: 'recordReassign',
        label: tDocuments('record.actions.changeReviewer'),
        icon: UserCog,
        onClick: dialogs.open.recordReassign,
        visible: canWrite && enabled && record?.state === 'in_review',
      },
      {
        key: 'recordRevision',
        label: tDocuments('record.actions.newRevision'),
        icon: FilePen,
        onClick: handleOpenRevision,
        visible: canWrite && enabled && record?.state === 'approved',
        disabled: isOpeningRevision,
      },
    ],
    [
      tDocuments,
      handleMarkControlled,
      handleOpenRevision,
      canWrite,
      enabled,
      canBecomeControlled,
      dialogs.open,
      isMarkingControlled,
      isOpeningRevision,
      isHeld,
      record,
    ],
  );

  const dialogNodes = (
    <>
      {organizationId != null && (
        <>
          <DocumentReplaceFileDialog
            open={dialogs.isOpen.recordReplace}
            onOpenChange={dialogs.setOpen.recordReplace}
            documentId={documentId}
            documentName={documentName}
            documentMimeType={mimeType}
            documentExtension={extension}
            organizationId={organizationId}
            recordVersion={record?.version ?? 0}
            expectedFileId={record?.currentFileId ?? ''}
            recordState={record?.state}
            isHeld={isHeld}
            restoreFocusRef={restoreFocusRef}
          />
          <DocumentRecordSubmitDialog
            open={dialogs.isOpen.recordSubmit}
            onOpenChange={dialogs.setOpen.recordSubmit}
            documentId={documentId}
            documentName={documentName}
            organizationId={organizationId}
          />
          <DocumentRecordSubmitDialog
            open={dialogs.isOpen.recordReassign}
            onOpenChange={dialogs.setOpen.recordReassign}
            documentId={documentId}
            documentName={documentName}
            organizationId={organizationId}
            standingReviewer={{
              userId: record?.reviewerUserId,
              name: record?.reviewerName,
            }}
          />
        </>
      )}

      <DocumentRecordReviewDialog
        open={dialogs.isOpen.recordReview}
        onOpenChange={dialogs.setOpen.recordReview}
        documentId={documentId}
        documentName={documentName}
        record={record}
      />
    </>
  );

  return { actions, dialogs: dialogNodes, isHeld, isRecordProtected };
}
