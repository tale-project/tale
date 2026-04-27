import type { ImagePart, ModelMessage } from 'ai';

import type { ActionCtx } from '../../_generated/server';
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
 * Reads images directly from `_storage` and inlines them. Does NOT mutate
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
  },
): Promise<BuildInlineMultiModalPromptResult> {
  const { userText, imageAttachments } = params;

  const imageParts: ImagePart[] = [];
  const skippedImages: Array<{ fileName: string; reason: string }> = [];

  for (const att of imageAttachments) {
    try {
      const blob = await ctx.storage.get(att.fileId);
      if (!blob) {
        skippedImages.push({
          fileName: att.fileName,
          reason: 'not found in storage',
        });
        continue;
      }
      if (blob.size > MAX_IMAGE_BYTES) {
        const sizeMB = (blob.size / (1024 * 1024)).toFixed(2);
        const maxMB = (MAX_IMAGE_BYTES / (1024 * 1024)).toFixed(0);
        skippedImages.push({
          fileName: att.fileName,
          reason: `${sizeMB}MB exceeds ${maxMB}MB limit`,
        });
        continue;
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      imageParts.push({
        type: 'image',
        image: bytes,
        mediaType: blob.type || att.fileType || 'image/png',
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
