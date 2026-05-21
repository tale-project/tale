import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import { resolveArtifactFiles } from '../../artifacts/resolve_files';

/**
 * Hard upper bound on total bytes of file content injected as artifact
 * context across the whole block. The metadata header (artifact id/type/
 * title/revision/entryFile/fileCount per row) is always emitted; only file
 * bodies are subject to truncation.
 */
const MAX_TOTAL_BODY_BYTES = 80_000;

/** Per-file body cap before truncation sentinel. */
const MAX_PER_FILE_BYTES = 30_000;

/**
 * Build the LLM-facing artifacts block for the current thread.
 *
 * Each artifact becomes a `<artifact>` element listing its files as nested
 * `<file>` blocks. Multi-file projects emit one `<file>` per path; legacy
 * single-file artifacts (with only `content` on the row) emit one
 * synthesized `<file path="defaultEntry">` via `resolveArtifactFiles`.
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

  // Walk newest first so the latest artifacts claim file-body budget first.
  // Metadata is always emitted (it's cheap and important for the LLM to know
  // what exists). We reverse blocks at the end to keep chronological order.
  const ordered = artifacts.toReversed();
  let totalBodyBytes = 0;
  const blocks: string[] = [];
  for (const artifact of ordered) {
    const resolved = resolveArtifactFiles(artifact);
    const langAttr = artifact.language
      ? ` language=${JSON.stringify(artifact.language)}`
      : '';
    const runAttr = buildRunAttrs(artifact);
    const headerAttrs = `id="${artifact._id}" type="${artifact.type}"${langAttr}${runAttr} title=${JSON.stringify(
      artifact.title,
    )} revision="${artifact.revision}" entryFile=${JSON.stringify(resolved.entryFile)} fileCount="${resolved.files.length}"`;

    const fileBlocks: string[] = [];
    for (const file of resolved.files) {
      const truncated = truncateFileBody(file.content);
      if (totalBodyBytes + truncated.length > MAX_TOTAL_BODY_BYTES) {
        fileBlocks.push(
          `<file path=${JSON.stringify(file.path)} size="${file.content.length}" omitted="true" />`,
        );
        continue;
      }
      totalBodyBytes += truncated.length;
      const body = sanitizeFileBody(truncated);
      fileBlocks.push(
        `<file path=${JSON.stringify(file.path)} size="${file.content.length}">\n${body}\n</file>`,
      );
    }
    blocks.push(
      `<artifact ${headerAttrs}>\n${fileBlocks.join('\n')}\n</artifact>`,
    );
  }
  blocks.reverse();

  return [
    blocks.join('\n\n'),
    '',
    'You may modify any of these via the `artifact_edit` tool. Modes: `rewrite` (whole file, creates if missing), `patch` (one search/replace, optional `replaceAll`), `delete` (remove a file), `rename` (rename a file; auto-repoints entryFile if matched), `set_entry` (repoint entry pointer). Pass the artifact\'s `revision="N"` back as `expectedRevision` so a concurrent edit by another turn is detected (the call will return `code: "stale"` instead of overwriting). Snippets inside `<file>` bodies appear verbatim and can be used as `search` blocks for patches. If you see `runStale="true"` on a runnable artifact, the source was edited after the last run — call `artifact_run` again to refresh outputs. To create a NEW artifact use `artifact_create`; calling create with an existing title returns the existing artifactId and does NOT overwrite.',
  ].join('\n');
}

function truncateFileBody(content: string): string {
  if (content.length <= MAX_PER_FILE_BYTES) return content;
  return (
    content.slice(0, MAX_PER_FILE_BYTES) +
    `\n\n[...truncated; ${content.length - MAX_PER_FILE_BYTES} more characters elided. Call artifact_read({artifactId, path}) to fetch the rest.]`
  );
}

interface ArtifactRowForContext {
  type: string;
  revision: number;
  runStatus?: string;
  runErrorCode?: string;
  runOutputFiles?: { name: string }[];
  runRevision?: number;
}

function buildRunAttrs(artifact: ArtifactRowForContext): string {
  if (
    artifact.type !== 'python_runnable' &&
    artifact.type !== 'node_runnable'
  ) {
    return '';
  }
  if (
    artifact.runRevision !== undefined &&
    artifact.runRevision !== artifact.revision
  ) {
    return ' runStale="true"';
  }
  const parts: string[] = [];
  if (artifact.runStatus) parts.push(`runStatus="${artifact.runStatus}"`);
  if (artifact.runErrorCode) {
    parts.push(`runErrorCode="${artifact.runErrorCode}"`);
  }
  if (artifact.runOutputFiles && artifact.runOutputFiles.length > 0) {
    const names = artifact.runOutputFiles
      .map((f) => f.name)
      .join(',')
      .slice(0, 200);
    parts.push(`runOutputFiles=${JSON.stringify(names)}`);
  }
  return parts.length ? ' ' + parts.join(' ') : '';
}

function sanitizeFileBody(body: string): string {
  return body
    .replace(/<\/file>/gi, '<\\/file>')
    .replace(/<\/artifact>/gi, '<\\/artifact>')
    .replace(/<\/details>/gi, '<\\/details>');
}
