/**
 * Helper for file generation tools to append the generated file as a
 * downloadable card in the chat message.
 *
 * After a successful generate operation, call this to save a file part
 * on the current assistant message. The SDK groups it with the text
 * response at the same order, so it renders as a download card in the UI.
 */

import type { ToolCtx } from '@convex-dev/agent';

import { internal } from '../../../_generated/api';

// The ToolCtx type declares `messageId` but the SDK runtime sets `promptMessageId`
// on the ctx object (see @convex-dev/agent/dist/client/start.js). We cast to access it.
interface ToolCtxRuntime extends ToolCtx {
  promptMessageId?: string;
  parentThreadId?: string;
}

export async function appendFilePart(
  ctx: ToolCtx,
  args: {
    fileName: string;
    mimeType: string;
    downloadUrl: string;
  },
): Promise<boolean> {
  const { threadId } = ctx;
  const runtime = ctx as ToolCtxRuntime;
  const promptMessageId = runtime.promptMessageId;

  // Skip if sub-agent — the card would land on the sub-thread which the user
  // never sees. Returning false lets the real downloadUrl propagate back to
  // the parent agent instead.
  if (!threadId || !promptMessageId || runtime.parentThreadId) return false;

  await ctx.runAction(
    internal.agent_tools.files.internal_mutations.appendGeneratedFilePart,
    {
      threadId,
      promptMessageId,
      fileName: args.fileName,
      mimeType: args.mimeType,
      downloadUrl: args.downloadUrl,
    },
  );
  return true;
}
