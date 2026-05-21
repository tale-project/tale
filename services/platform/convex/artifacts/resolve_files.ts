import type { Doc } from '../_generated/dataModel';
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
