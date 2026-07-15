import type { ImagePart, ModelMessage } from 'ai';

import type { ActionCtx } from '../../_generated/server';
import { fetchBlobArrayBuffer } from '../storage/blob_read_any';
import type { FileAttachment } from './types';

const MAX_IMAGE_BYTES = 1 * 1024 * 1024;

export interface BuildInlineMultiModalPromptResult {
  prompt: ModelMessage[];
  inlinedImageCount: number;
  skippedImages: Array<{ fileName: string; reason: string }>;
}

/**
 * Build a multimodal user message with image bytes embedded as ImagePart.
 *
 * Reads image bytes through the backend-aware seam (`_storage` directly, or a
 * presigned fetch for an `s3:`-backed org) and inlines them. Does NOT mutate
 * the agent component's file registry — that registration is upload-time
 * scope, not per-turn.
 *
 * Pass the *un-augmented* user text. Non-image attachments (PDFs, audio)
 * are referenced via the saved-message markdown that the model already
 * sees through thread context, so they are not duplicated here.
 */
export async function buildInlineMultiModalPrompt(
  ctx: ActionCtx,
  params: {
    userText: string;
    imageAttachments: FileAttachment[];
    /** Owning org (Better Auth id) — resolves the bucket for `s3:` refs. */
    organizationId: string;
  },
): Promise<BuildInlineMultiModalPromptResult> {
  const { userText, imageAttachments } = params;

  const imageParts: ImagePart[] = [];
  const skippedImages: Array<{ fileName: string; reason: string }> = [];

  for (const att of imageAttachments) {
    try {
      const read = await fetchBlobArrayBuffer(
        ctx,
        params.organizationId,
        att.fileId,
      );
      if (!read) {
        skippedImages.push({
          fileName: att.fileName,
          reason: 'not found in storage',
        });
        continue;
      }
      if (read.bytes.byteLength > MAX_IMAGE_BYTES) {
        const sizeMB = (read.bytes.byteLength / (1024 * 1024)).toFixed(2);
        const maxMB = (MAX_IMAGE_BYTES / (1024 * 1024)).toFixed(0);
        skippedImages.push({
          fileName: att.fileName,
          reason: `${sizeMB}MB exceeds ${maxMB}MB limit`,
        });
        continue;
      }
      const bytes = new Uint8Array(read.bytes);
      imageParts.push({
        type: 'image',
        image: bytes,
        mediaType: read.contentType || att.fileType || 'image/png',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      skippedImages.push({
        fileName: att.fileName,
        reason: `read failed: ${message}`,
      });
    }
  }

  const content: Array<{ type: 'text'; text: string } | ImagePart> = [
    { type: 'text', text: userText },
    ...imageParts,
  ];

  if (skippedImages.length > 0) {
    const lines = skippedImages.map((s) => `- ${s.fileName}: ${s.reason}`);
    content.push({
      type: 'text',
      text: `\n\n[Some images could not be included]\n${lines.join('\n')}`,
    });
  }

  return {
    prompt: [{ role: 'user', content }],
    inlinedImageCount: imageParts.length,
    skippedImages,
  };
}
