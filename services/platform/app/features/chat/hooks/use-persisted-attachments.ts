'use client';

import { useEffect, useMemo, useRef } from 'react';

import type { Id } from '@/convex/_generated/dataModel';

import type { FileAttachment } from './use-convex-file-upload';

import { useFileUrls } from './queries';

const STORAGE_KEY_PREFIX = 'chat-attachments-';

interface PersistedAttachment {
  fileId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
}

function storageKey(threadId?: string) {
  return `${STORAGE_KEY_PREFIX}${threadId ?? 'new'}`;
}

function loadPersisted(threadId?: string): PersistedAttachment[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(storageKey(threadId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePersisted(
  threadId: string | undefined,
  attachments: FileAttachment[],
) {
  if (typeof window === 'undefined') return;
  const key = storageKey(threadId);
  if (attachments.length === 0) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* noop */
    }
    return;
  }
  try {
    const data: PersistedAttachment[] = attachments.map((att) => ({
      fileId: att.fileId,
      fileName: att.fileName,
      fileType: att.fileType,
      fileSize: att.fileSize,
    }));
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    /* noop */
  }
}

function toFileAttachment(
  p: PersistedAttachment,
  previewUrl?: string,
): FileAttachment {
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- fileId from localStorage needs cast back to Convex Id type
    fileId: p.fileId as Id<'_storage'>,
    fileName: p.fileName,
    fileType: p.fileType,
    fileSize: p.fileSize,
    previewUrl,
  };
}

interface UsePersistedAttachmentsOptions {
  threadId?: string;
  attachments: FileAttachment[];
  setAttachments: (attachments: FileAttachment[]) => void;
}

export function usePersistedAttachments({
  threadId,
  attachments,
  setAttachments,
}: UsePersistedAttachmentsOptions) {
  const prevThreadIdRef = useRef(threadId);
  const isRestoringRef = useRef(false);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;

  // On mount: restore from localStorage for the initial thread
  const hasRestoredRef = useRef(false);
  if (!hasRestoredRef.current) {
    hasRestoredRef.current = true;
    const persisted = loadPersisted(threadId);
    if (persisted.length > 0) {
      isRestoringRef.current = true;
      setAttachments(persisted.map((p) => toFileAttachment(p)));
    }
  }

  // On thread switch: save current, restore new
  if (prevThreadIdRef.current !== threadId) {
    savePersisted(prevThreadIdRef.current, attachmentsRef.current);
    prevThreadIdRef.current = threadId;

    const persisted = loadPersisted(threadId);
    isRestoringRef.current = true;
    setAttachments(
      persisted.length > 0 ? persisted.map((p) => toFileAttachment(p)) : [],
    );
  }

  // Persist to localStorage when attachments change (skip restore-triggered updates)
  useEffect(() => {
    if (isRestoringRef.current) {
      isRestoringRef.current = false;
      return;
    }
    savePersisted(threadId, attachments);
  }, [threadId, attachments]);

  // Fetch serving URLs for image attachments that don't have a preview URL yet
  const imageFileIdsNeedingUrl = useMemo(
    () =>
      attachments
        .filter((att) => att.fileType.startsWith('image/') && !att.previewUrl)
        .map((att) => att.fileId),
    [attachments],
  );

  const { data: fileUrls } = useFileUrls(
    imageFileIdsNeedingUrl,
    imageFileIdsNeedingUrl.length === 0,
  );

  // Merge fetched URLs back into attachments
  useEffect(() => {
    if (!fileUrls || fileUrls.length === 0) return;

    const urlMap = new Map<string, string>();
    for (const { fileId, url } of fileUrls) {
      if (url) urlMap.set(fileId, url);
    }

    // Only update if there are new URLs to merge
    const currentAtts = attachmentsRef.current;
    const needsUpdate = currentAtts.some(
      (att) => !att.previewUrl && urlMap.has(att.fileId),
    );
    if (!needsUpdate) return;

    isRestoringRef.current = true;
    setAttachments(
      currentAtts.map((att) => {
        if (att.previewUrl) return att;
        const url = urlMap.get(att.fileId);
        return url ? { ...att, previewUrl: url } : att;
      }),
    );
  }, [fileUrls, setAttachments]);
}
