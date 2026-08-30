'use node';

/**
 * Generate a DOCX document from structured content in-process and store it in
 * Convex storage.
 *
 * The real implementation assembled OOXML via the moved
 * `convex/crawler/lib/docx_generate` — gone with the rest of the crawler/RAG
 * rewrite. There is currently no live caller (the only caller was the moved
 * `agent_tools/documents/` plane, via `documents/internal_actions.ts`'s thin
 * `generateDocx` wrapper), but this stays a throwing stub rather than a
 * silent success, since callers expect a real generated file back.
 *
 * This is the model-layer helper; Convex actions call it via a thin wrapper in
 * `convex/documents/internal_actions.ts`.
 */

import { AppError } from '../../lib/shared/errors/app-error';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';

export interface DocxSection {
  type:
    | 'heading'
    | 'paragraph'
    | 'bullets'
    | 'numbered'
    | 'table'
    | 'quote'
    | 'code';
  text?: string;
  level?: number;
  items?: string[];
  headers?: string[];
  rows?: string[][];
}

export interface DocxContent {
  title?: string;
  subtitle?: string;
  sections: DocxSection[];
}

export interface GenerateDocxArgs {
  organizationId: string;
  fileName: string;
  content: DocxContent;
}

export interface GenerateDocxResult {
  success: boolean;
  fileStorageId: Id<'_storage'>;
  downloadUrl: string;
  fileName: string;
  contentType: string;
  size: number;
}

/**
 * Offline. See file header.
 */
export async function generateDocx(
  _ctx: ActionCtx,
  _args: GenerateDocxArgs,
): Promise<GenerateDocxResult> {
  throw new AppError(
    'DOCX generation is offline while the platform AI backend is rewritten.',
  );
}
