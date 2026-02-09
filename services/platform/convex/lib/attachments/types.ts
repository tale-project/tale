/**
 * Shared types for attachment handling in AI agents.
 */

import type { ImagePart as AIImagePart, FilePart as AIFilePart } from 'ai';

import type { Id } from '../../_generated/dataModel';

/**
 * File attachment from the client
 */
export interface FileAttachment {
  fileId: Id<'_storage'>;
  fileName: string;
  fileType: string;
  fileSize: number;
}

/**
 * Result of registering files with the agent component
 */
export interface RegisteredFile {
  agentFileId: string;
  storageId: Id<'_storage'>;
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
