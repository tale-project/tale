import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { DOCUMENT_MAX_FILE_SIZE } from '../../lib/shared/file-types';
import { blobRefValidator } from '../lib/storage/blob_ref';

/**
 * Thread workspace files — the unifying primitive that replaces the old
 * artifact / artifact-file / artifact-output / runnable-artifact stack.
 *
 * Every file the LLM writes (via `file_write` tool), every file the user
 * uploads as a chat attachment, and every file `run_code` harvests from
 * the sandbox lands as one row keyed by `(threadId, path)`. The canvas UI
 * subscribes to this table for the current thread, sorts by `updatedAt`,
 * and picks a renderer based on the path's extension (`.html` → iframe,
 * `.md` → markdown, `.py` → code, etc.).
 *
 * Path semantics: POSIX-relative, NFC-normalized, no leading slash, no
 * `..`, restricted character set (validated by
 * `convex/agent_tools/files/_shared.ts:validatePath`). A `(threadId, path)`
 * unique constraint is enforced at the mutation layer (Convex doesn't
 * support DB-level uniqueness — the write mutation does the lookup +
 * upsert atomically).
 */
export const threadFilesTable = defineTable({
  organizationId: v.string(),
  threadId: v.string(),
  /** POSIX-relative path inside the thread workspace, e.g. `scripts/gen.py`. */
  path: v.string(),
  /**
   * Content blob REFERENCE: a Convex `_storage` id (deployment default) OR an
   * `s3:<key>` ref when the org brings its own bucket (writers route through
   * the blob seam). Widened from `v.id('_storage')` — existing ids validate.
   */
  storageId: blobRefValidator,
  size: v.number(),
  /** MIME inferred from path extension or sniffed at write time. */
  contentType: v.string(),
  /**
   * SHA-256 hex of the file bytes — populated by `_storage` automatically
   * once we hand off via storage URL.
   */
  sha256: v.optional(v.string()),
  /** Why this file exists in the workspace. */
  source: v.union(
    v.literal('user_upload'),
    v.literal('agent_write'),
    v.literal('run_output'),
  ),
  /**
   * Render override — defaults to extension-based inference. The LLM (or a
   * future UI affordance) can pin a specific renderer when the extension
   * is ambiguous (e.g. an `.svg` that should be shown as code rather than
   * rasterized).
   */
  renderHint: v.optional(
    v.union(
      v.literal('html'),
      v.literal('svg'),
      v.literal('mermaid'),
      v.literal('markdown'),
      v.literal('code'),
      v.literal('image'),
      v.literal('attachment'),
    ),
  ),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  // Path lookups within a thread — backs file_read / file_write upsert path.
  .index('by_thread_and_path', ['threadId', 'path'])
  // file_list + canvas rendering — newest first.
  .index('by_thread_and_updatedAt', ['threadId', 'updatedAt'])
  // Org-wide forensics + retention sweeps.
  .index('by_organizationId', ['organizationId']);

/**
 * Per-thread workspace caps. Server-side enforced by `file_write`; matching
 * client validation lives in the tool description so the LLM can self-correct
 * before the round-trip.
 */
/**
 * Per-file cap ≡ the chat/document upload cap: anything a user can upload can
 * be filed into the workspace and staged into the sandbox (the container-side
 * URL-fetch cap is sized to match — `FETCH_MAX_BYTES` in the runnerd daemon).
 * Do not diverge the two: a workspace cap below the upload cap silently
 * withholds legitimately uploaded files from `run_code` (the 30MB-log bug).
 */
export const THREAD_FILE_MAX_BYTES = DOCUMENT_MAX_FILE_SIZE; // 100 MB per file
export const THREAD_WORKSPACE_MAX_FILES = 100;
export const THREAD_WORKSPACE_MAX_BYTES = 1024 * 1024 * 1024; // 1 GB total
