'use node';

/**
 * Node-only fast-path model resolver.
 *
 * `resolve_model.ts` resolves models via `ctx.runAction(file_actions.resolveModelData)`
 * ON PURPOSE — that node→backend hop keeps `resolve_model.ts` importable by V8
 * code (e.g. workflow LLM nodes) without pulling the disk/SOPS provider loader
 * into a V8 bundle. But the chat generation path is entirely in node, so it can
 * resolve in-process and skip the ~340ms runAction hop. This module is imported
 * ONLY by node actions (chat generation); never by V8 code.
 */

import type { ActionCtx } from '../_generated/server';
import { resolveModelDataInline } from './file_actions';
import { createLanguageModel } from './resolve_model';

export async function resolveLanguageModelByIdNode(
  ctx: ActionCtx,
  opts: { modelId: string; providerName?: string; organizationId: string },
) {
  const modelData = await resolveModelDataInline(ctx, {
    modelId: opts.modelId,
    providerName: opts.providerName,
    organizationId: opts.organizationId,
  });
  return { languageModel: createLanguageModel(modelData), modelData };
}
