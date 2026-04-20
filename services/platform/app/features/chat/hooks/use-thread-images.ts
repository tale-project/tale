'use client';

import { useMemo } from 'react';

import type {
  FileAttachment,
  FilePart,
} from '../components/message-bubble/types';

interface MessageLike {
  id: string;
  role: 'user' | 'assistant' | 'system';
  timestamp: Date;
  attachments?: FileAttachment[];
  fileParts?: FilePart[];
}

export interface ThreadImage {
  /** Unique key for React lists (messageId + index). */
  key: string;
  /** Convex storage id extracted from the image URL, if present. */
  fileId?: string;
  /** Display URL for the thumbnail / preview. */
  url: string;
  /** IANA media type, e.g. 'image/png'. */
  mimeType: string;
  /** Original filename if known. */
  fileName?: string;
  /** Which side of the conversation this image belongs to. */
  role: 'user' | 'assistant';
  /** Chronological ordering. */
  timestamp: Date;
  /** Message this image was attached to / produced for. */
  messageId: string;
}

function extractStorageFileId(url: string): string | undefined {
  try {
    return new URL(url).searchParams.get('id') ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Derives a chronological list of every image visible in the given thread —
 * assistant-generated file parts AND user-uploaded image attachments alike.
 *
 * Used by EditingBanner (to pre-attach the latest image) and ThumbnailPicker
 * (to let the user pick a specific older image to edit).
 *
 * No new query — pulls from the messages already loaded by useThreadMessages.
 */
export function useThreadImages(
  messages: MessageLike[] | undefined,
): ThreadImage[] {
  return useMemo(() => {
    if (!messages || messages.length === 0) return [];

    const images: ThreadImage[] = [];
    for (const msg of messages) {
      if (msg.role !== 'user' && msg.role !== 'assistant') continue;
      const role: 'user' | 'assistant' = msg.role;
      // Assistant-generated images land on fileParts[] (image/*).
      if (msg.fileParts) {
        msg.fileParts.forEach((part, i) => {
          if (!part.mediaType.startsWith('image/')) return;
          images.push({
            key: `${msg.id}-fp-${i}`,
            fileId: extractStorageFileId(part.url),
            url: part.url,
            mimeType: part.mediaType,
            fileName: part.filename,
            role,
            timestamp: msg.timestamp,
            messageId: msg.id,
          });
        });
      }
      // User-uploaded images land on attachments[]. previewUrl is a blob: URL
      // during upload; skip those — they aren't yet persisted.
      if (msg.attachments) {
        msg.attachments.forEach((att, i) => {
          if (!att.fileType.startsWith('image/')) return;
          if (att.previewUrl) return;
          images.push({
            key: `${msg.id}-att-${i}`,
            fileId: att.fileId,
            // attachments don't carry a URL here; component should resolve via
            // useFileUrls. We surface the fileId as the canonical handle so
            // pre-attach works; consumers use fileId to reupload-reference.
            url: '',
            mimeType: att.fileType,
            fileName: att.fileName,
            role,
            timestamp: msg.timestamp,
            messageId: msg.id,
          });
        });
      }
    }
    // Newest first makes "latest image" a simple images[0] read.
    return images.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }, [messages]);
}
