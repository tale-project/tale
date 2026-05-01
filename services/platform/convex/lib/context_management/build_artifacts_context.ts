import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';

/**
 * Hard upper bound on the total characters injected as artifact context.
 * If artifacts exceed this, the oldest are summarised instead. Tuned so
 * a single ~50KB HTML document still round-trips, but a thread accumulating
 * dozens of large artifacts cannot blow the model's context window.
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
 * no artifacts so the caller can skip injecting an empty section.
 */
export async function buildArtifactsContext(
  ctx: ActionCtx,
  organizationId: string,
  threadId: string,
): Promise<string | undefined> {
  const artifacts = await ctx.runQuery(
    internal.artifacts.internal_queries.listByThread,
    { organizationId, threadId },
  );
  if (artifacts.length === 0) return undefined;

  let totalBytes = 0;
  const blocks: string[] = [];
  for (const artifact of artifacts) {
    const body = truncateArtifactBody(artifact.content);
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
