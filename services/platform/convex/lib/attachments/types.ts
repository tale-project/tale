/**
 * Shared types for attachment handling in AI agents.
 */

import type { ImagePart as AIImagePart, FilePart as AIFilePart } from 'ai';

import type { BlobRef } from '../storage/blob_ref';

/**
 * File attachment from the client.
 *
 * `fileId` is a blob REFERENCE: a Convex `_storage` id (deployment default)
 * OR an `s3:<key>` ref when the org brings its own bucket — every consumer
 * of this type must be backend-aware (`convexStorageId` / the blob seam),
 * never pass it to `ctx.storage.*` directly.
 */
export interface FileAttachment {
  fileId: BlobRef;
  fileName: string;
  fileType: string;
  fileSize: number;
}

/**
 * Result of registering files with the agent component
 */
export interface RegisteredFile {
  /** Agent-component registry id for Convex-backed blobs; an `s3:` blob is
   *  not component-registered (the registry vacuums `_storage` only). */
  agentFileId?: string;
  storageId: BlobRef;
  imagePart?: AIImagePart;
  filePart: AIFilePart;
  fileUrl: string;
  attachment: FileAttachment;
  isImage: boolean;
}

/**
 * Content parts that can be sent to the AI model
 */
export type MessageContentPart = AIImagePart | { type: 'text'; text: string };

/**
 * Result of building multi-modal content from registered files
 */
export interface MultiModalContent {
  contentParts: MessageContentPart[];
  hasImages: boolean;
  hasNonImageFiles: boolean;
}
