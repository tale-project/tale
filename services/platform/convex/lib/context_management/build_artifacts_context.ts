import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';

/**
 * Hard upper bound on the total characters injected as artifact context.
 * When the thread holds more than fits, the *oldest* artifacts collapse
 * into omitted stubs so the most recent state stays visible — the model
 * needs the latest revisions to patch correctly.
 */
const MAX_TOTAL_BYTES = 80_000;

/**
 * Per-artifact body cap. Artifacts longer than this are truncated with
 * a sentinel; the model can still see the head of the document and call
 * `artifact_edit` against snippets it remembers from a prior turn.
 */
const MAX_PER_ARTIFACT_BYTES = 30_000;

/**
 * Build the LLM-facing artifacts block for the current thread.
 *
 * The block is XML-shaped (not collapsible HTML) so the model can parse
 * IDs/types/revisions reliably. Returns `undefined` when the thread has
 * no artifacts so the caller can skip injecting an empty section, and
 * also when the underlying query fails — artifact context is enrichment,
 * not load-bearing, so a transient failure should not abort the turn.
 */
export async function buildArtifactsContext(
  ctx: ActionCtx,
  organizationId: string,
  threadId: string,
): Promise<string | undefined> {
  let artifacts;
  try {
    artifacts = await ctx.runQuery(
      internal.artifacts.internal_queries.listByThread,
      { organizationId, threadId },
    );
  } catch (error) {
    console.warn('[artifacts_context] Failed to list artifacts, degrading', {
      organizationId,
      threadId,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }

  if (artifacts.length === 0) return undefined;

  // Walk newest first so the latest artifacts always claim budget; emit
  // omitted stubs for the *oldest* once full. We reverse the resulting
  // blocks at the end so the prompt stays in chronological order.
  const ordered = artifacts.toReversed();
  let totalBytes = 0;
  const blocks: string[] = [];
  for (const artifact of ordered) {
    const body = sanitizeArtifactBody(truncateArtifactBody(artifact.content));
    const bytes = body.length;
    if (totalBytes + bytes > MAX_TOTAL_BYTES) {
      blocks.push(
        `<artifact id="${artifact._id}" type="${artifact.type}" title=${JSON.stringify(artifact.title)} revision="${artifact.revision}" omitted="true" />`,
      );
      continue;
    }
    totalBytes += bytes;
    const langAttr = artifact.language
      ? ` language=${JSON.stringify(artifact.language)}`
      : '';
    blocks.push(
      `<artifact id="${artifact._id}" type="${artifact.type}"${langAttr} title=${JSON.stringify(artifact.title)} revision="${artifact.revision}">\n${body}\n</artifact>`,
    );
  }
  blocks.reverse();

  return [
    blocks.join('\n\n'),
    '',
    'You may modify any of these via the `artifact_edit` tool — prefer `mode: "patch"` for small changes. Do NOT re-emit an artifact via `artifact_create`; that creates a duplicate. Snippets in <artifact> bodies appear verbatim and can be used as `search` blocks for patches.',
  ].join('\n');
}

function truncateArtifactBody(content: string): string {
  if (content.length <= MAX_PER_ARTIFACT_BYTES) return content;
  return (
    content.slice(0, MAX_PER_ARTIFACT_BYTES) +
    `\n\n[...truncated; ${content.length - MAX_PER_ARTIFACT_BYTES} more characters elided. Re-read the artifact via search snippets you remember from earlier turns.]`
  );
}

/**
 * Defuse delimiter-injection: a user/agent-authored artifact body could
 * contain `</artifact>` or `</details>` and prematurely close the wrapper
 * (the outer `<details>` block is added by `formatArtifactsContext`). The
 * model would then read whatever follows as if it were a top-level
 * instruction. Replacing the closing-tag form with a backslash-escaped
 * variant keeps the bytes the model sees readable but breaks the parse.
 */
function sanitizeArtifactBody(body: string): string {
  return body
    .replace(/<\/artifact>/gi, '<\\/artifact>')
    .replace(/<\/details>/gi, '<\\/details>');
}
