'use node';

/**
 * Generate a document (PDF / image / DOCX) in-process and store it in Convex
 * storage.
 *
 * The real implementation rendered HTML/markdown via the
 * moved crawler libs (`convex/crawler/lib/{docx_generate,markdown_to_html,
 * sandbox_render_document}`) — gone with the rest of the crawler/RAG rewrite.
 * There is currently no live caller (the only caller was the moved
 * `agent_tools/documents/` plane, via `documents/internal_actions.ts`'s thin
 * `generateDocument` wrapper), but this stays a throwing stub — the same
 * "offline" `AppError` this would raise once the agent-tools plane is
 * rewritten to call it again — rather than a silent success, since callers
 * expect a real generated file back.
 *
 * This is the model-layer helper; Convex actions call it via a thin wrapper in
 * `convex/documents/internal_actions.ts`.
 */

import { AppError } from '../../lib/shared/errors/app-error';
import type { ActionCtx } from '../_generated/server';
import type { GenerateDocumentArgs, GenerateDocumentResult } from './types';

/**
 * Offline. See file header.
 */
export async function generateDocument(
  _ctx: ActionCtx,
  _args: GenerateDocumentArgs,
): Promise<GenerateDocumentResult> {
  throw new AppError(
    'Document generation is offline while the platform AI backend is rewritten.',
  );
}
