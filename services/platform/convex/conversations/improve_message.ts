import type { ActionCtx } from '../_generated/server';

// The real implementation ran a mechanical-rewrite
// `generateText` call through an Agent SDK instance — its model resolution
// (`convex/providers/`), reasoning-options builder
// (`lib/agent_response/reasoning/build_reasoning_options`), and prompt
// registry (`lib/prompts/registry`) all moved with the chat pipeline.
// `improveMessage` already had a graceful degrade path for a failed AI call
// (falls back to the original message plus an `error` string) — offline
// reuses that exact contract rather than throwing, so the message editor's
// existing handling (`if (result.error) toast({ title: result.error })`,
// `app/features/conversations/components/message-editor.tsx`) shows a
// precise reason instead of the generic catch-block toast.

/**
 * Offline — returns the original message unchanged with an
 * explanatory `error`. See file header.
 */
export async function improveMessage(
  _ctx: ActionCtx,
  args: {
    originalMessage: string;
    instruction?: string;
  },
): Promise<{ improvedMessage: string; error?: string }> {
  console.debug(
    '[improveMessage] Message improvement is offline while the platform AI backend is rewritten',
  );
  return {
    improvedMessage: args.originalMessage,
    error:
      'Message improvement is offline while the platform AI backend is rewritten.',
  };
}
