'use client';

import { toast } from '@tale/ui/use-toast';
import { useQuery as useTanstackQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useEffect, useMemo, useRef } from 'react';

import type { FileAttachment } from '@/app/features/shared/files/types';
import { fileStatusesQuery } from '@/app/lib/backend/chat';
import type { BlobRef } from '@/backend/core/lib/storage/blob_ref';
import { useT } from '@/lib/i18n/client';
import {
  documentHoldsSend,
  type DocumentTextStatus,
} from '@/lib/shared/document-reading';
import { shouldRagIndexOnUpload } from '@/lib/shared/file-types';

import { useChatQueryClient } from '../data/chat-backend';
import {
  documentChipStatus,
  documentReadingState,
  type DocumentReadingState,
} from '../utils/document-chip-status';

// 'unsupported' is a terminal, non-retryable status: the RAG service has no
// text extractor for the format, so the file will NEVER index — distinct
// from 'failed', which may be transient.
type RagStatus = 'queued' | 'running' | 'completed' | 'failed' | 'unsupported';

export interface FileIndexingInfo {
  /** The index's state. */
  status?: RagStatus;
  error?: string;
  /** The stable cause behind `error` (`rag_error_codes.ts`). */
  errorCode?: string;
  progress?: string;
  /** The read for the assistant, ahead of the index. */
  textStatus?: DocumentTextStatus;
  /** Why a read is not ready (`text_error_code`). */
  textErrorCode?: string;
}

/**
 * The verdicts already told, by file: each is told once per page however
 * often the composer remounts, so a refusal is not repeated by a remount.
 */
const told = new Map<BlobRef, DocumentReadingState['kind']>();

/** Forget the verdicts told — for tests only. */
export function forgetToldVerdictsForTests(): void {
  told.clear();
}

/** The busy states: a verdict reached from one of them was watched. */
function inProgress(kind: DocumentReadingState['kind'] | undefined) {
  return kind === 'reading' || kind === 'indexing';
}

/**
 * Read and index status for document / text attachments staged in the
 * composer. The status query polls every two seconds; the server-side jobs
 * move the row, and the watchdogs guarantee a terminal state.
 *
 * A document is read on a worker right after its upload — seconds — and a
 * message waits only for that read (`documentHoldsSend`, CHAT-R47), or for
 * the index of a document too large to read before it. `waitingForDocuments`
 * gates the send the same way transcription does; a document whose status
 * has not answered yet holds it too (`waitingForDocumentsUnknown`).
 *
 * Owns the upload feedback of documents (the upload hook defers their
 * success toast): "uploaded" once the assistant can read a document it
 * watched being read, "Index failed" once the index a document waited for
 * fails. A refusal by the organization's secret scan or PII policy, a file
 * with no readable text and a format no extractor reads are told whenever
 * they are first seen — once per page.
 */
export function useFileIndexingStatus(
  attachments: readonly FileAttachment[],
  organizationId: string,
) {
  const { t } = useT('chat');
  const fileIds = useMemo(
    () =>
      attachments
        .filter((a) => shouldRagIndexOnUpload(a.fileName, a.fileType))
        .map((a) => a.fileId),
    [attachments],
  );

  const statusesResult = useTanstackQuery(
    {
      ...fileStatusesQuery(organizationId ?? '', fileIds),
      enabled: Boolean(organizationId && fileIds.length > 0),
    },
    useChatQueryClient(),
  );
  const metadata = statusesResult.data;

  const statusMap = useMemo(() => {
    const map = new Map<BlobRef, FileIndexingInfo>();
    if (!metadata) return map;
    for (const m of metadata) {
      map.set(m.storageId, {
        status: m.ragStatus,
        error: m.ragError,
        errorCode: m.ragErrorCode,
        progress: m.ragProgress,
        textStatus: m.textStatus,
        textErrorCode: m.textErrorCode,
      });
    }
    return map;
  }, [metadata]);

  const seenRef = useRef(new Map<BlobRef, DocumentReadingState['kind']>());
  useEffect(() => {
    if (!metadata) return;
    const seen = seenRef.current;
    for (const m of metadata) {
      const state = documentReadingState(statusMap.get(m.storageId));
      const before = seen.get(m.storageId);
      seen.set(m.storageId, state.kind);
      if (before === state.kind || told.get(m.storageId) === state.kind) {
        continue;
      }
      if (
        tellVerdict(t, state, m, statusMap.get(m.storageId), inProgress(before))
      ) {
        told.set(m.storageId, state.kind);
      }
    }
  }, [metadata, statusMap, t]);

  const waitingForDocuments = useMemo(
    () => metadata?.some((m) => documentHoldsSend(m)) ?? false,
    [metadata],
  );
  const waitingForDocumentsUnknown =
    fileIds.length > 0 && metadata === undefined;

  return { statusMap, waitingForDocuments, waitingForDocumentsUnknown };
}

/** Tell one document's verdict, in the words its chip shows. `watched`:
 * its read or index was seen in progress here, so its outcome is news. True
 * when something was told. */
function tellVerdict(
  t: TFunction,
  state: DocumentReadingState,
  file: {
    readonly fileName: string;
    readonly contentType: string;
    readonly size: number;
  },
  info: FileIndexingInfo | undefined,
  watched: boolean,
): boolean {
  if (state.kind === 'ready') {
    if (!watched) return false;
    toast({
      title: t('fileUploaded'),
      description: t('uploadedSuccessfully', { filename: file.fileName }),
    });
    return true;
  }
  // An index the document waited for failed — news only when it was seen.
  if (state.kind === 'indexFailed' && !watched) return false;
  const chip = documentChipStatus(
    t,
    {
      fileName: file.fileName,
      fileType: file.contentType,
      fileSize: file.size,
    },
    info,
  );
  // `reading` and `indexing` are no verdict; the rest always explain
  // themselves.
  if (chip.detail === undefined) return false;
  toast({
    title: chip.label,
    description: chip.detail,
    // A refusal and a failed index are errors; a file with no readable text
    // or a format nothing reads is a heads-up — the file is still attached.
    ...(chip.failed ? { variant: 'destructive' as const } : {}),
  });
  return true;
}
