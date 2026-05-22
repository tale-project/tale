import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import {
  defaultEntryFileFor,
  isValidArtifactType,
} from '../agent_tools/artifacts/shared';

export interface ResolvedArtifactFiles {
  files: readonly { readonly path: string; readonly content: string }[];
  entryFile: string;
  /** True iff the row was missing `files`/`entryFile` and we synthesized them from legacy `content`. */
  synthesized: boolean;
}

/**
 * Single source of truth for reading an artifact's project shape, regardless
 * of whether the row has migrated to the multi-file schema yet.
 *
 * - If the row has `files` and `entryFile` populated, return them as-is.
 * - Otherwise, synthesize a single-file project from the legacy `content`
 *   column using the type's default entry-file name.
 *
 * Every read path in Convex queries / mutations / UI / preview server MUST
 * route through this helper. Direct reads of `artifact.content` outside the
 * dual-write mirroring in mutations are a Phase A bug.
 */
export function resolveArtifactFiles(
  artifact: Pick<
    Doc<'artifacts'>,
    'type' | 'language' | 'content' | 'files' | 'entryFile'
  >,
): ResolvedArtifactFiles {
  if (
    artifact.files !== undefined &&
    artifact.files.length > 0 &&
    artifact.entryFile !== undefined
  ) {
    return {
      files: artifact.files,
      entryFile: artifact.entryFile,
      synthesized: false,
    };
  }
  // Legacy single-file row OR a row mid-migration. Synthesize.
  const type = isValidArtifactType(artifact.type) ? artifact.type : 'code';
  const entryFile = defaultEntryFileFor(type, artifact.language);
  return {
    files: [{ path: entryFile, content: artifact.content ?? '' }],
    entryFile,
    synthesized: true,
  };
}

/**
 * Mirror entry-file content back to the legacy `content` column for the
 * Phase A migration window — keeps rollback to pre-Phase-A code safe. Every
 * settle-path mutation MUST call this and write the returned string to the
 * row's `content` field alongside the canonical `files`/`entryFile`.
 */
export function mirrorLegacyContent(
  files: readonly { readonly path: string; readonly content: string }[],
  entryFile: string,
): string {
  const entry = files.find((f) => f.path === entryFile);
  return entry?.content ?? '';
}

/**
 * Load an artifact and overlay its `files` field with the canonical
 * `artifactFiles` table rows (when present). Mutations dual-write both the
 * embedded `artifacts.files[]` array and the per-file `artifactFiles` rows
 * via `syncArtifactFiles`; this helper lets read paths consume the table as
 * the authoritative source while staying compatible with rows that predate
 * the refactor's backfill (legacy rows have no `artifactFiles` rows — fall
 * back to whatever was on the doc).
 */
export async function loadArtifactWithFiles(
  ctx: QueryCtx | MutationCtx,
  artifactId: Id<'artifacts'>,
): Promise<Doc<'artifacts'> | null> {
  const doc = await ctx.db.get(artifactId);
  if (!doc) return null;
  const rows: { path: string; content: string }[] = [];
  for await (const row of ctx.db
    .query('artifactFiles')
    .withIndex('by_artifact', (q) => q.eq('artifactId', artifactId))) {
    rows.push({ path: row.path, content: row.content });
  }
  if (rows.length === 0) return doc;
  return { ...doc, files: rows };
}

/**
 * Compute total content bytes across all files in the project (used for
 * `assertAggregateSize`). UTF-8 byte length, not JS string length.
 */
export function aggregateFileBytes(
  files: readonly { readonly content: string }[],
): number {
  const encoder = new TextEncoder();
  let total = 0;
  for (const f of files) total += encoder.encode(f.content).byteLength;
  return total;
}
