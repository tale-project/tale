/**
 * Thin Convex internalMutation surface for artifact writes.
 *
 * The actual handler bodies, arg validators, and return validators live in
 * the `handlers/` subdirectory, grouped by concern:
 *
 *   - `handlers/shared.ts`        — helpers, size guards, validateFiles,
 *                                   clearStreamingFlags, trimRevisionHistory
 *   - `handlers/content_edits.ts` — createArtifact + file-level CRUD
 *                                   (artifact_file_create / artifact_file_update / artifact_file_delete
 *                                   / artifact_file_rename)
 *   - `handlers/streaming.ts`     — beginEditStream / abortStream /
 *                                   updateRewriteStreamingContent /
 *                                   discardActiveStreamsForThread /
 *                                   cleanupStaleStreams
 *   - `handlers/run_state.ts`     — setArtifactRunConfig / initArtifactRun /
 *                                   appendArtifactRunOutput /
 *                                   patchArtifactRunProgress /
 *                                   finalizeArtifactRun (+ the pure
 *                                   `applyFinalizeArtifactRun` helper)
 *
 * This file's job is purely to (1) declare the Convex API surface by
 * registering each handler with `internalMutation(...)` and (2) re-export
 * a few cross-module helpers (`MAX_ARTIFACT_BYTES`, `assertAggregateSize`,
 * `applyFinalizeArtifactRun`) that other modules import directly.
 */

import { internalMutation } from '../_generated/server';
import {
  createArtifactArgs,
  createArtifactHandler,
  createArtifactReturns,
  createFileInArtifactArgs,
  createFileInArtifactHandler,
  createFileInArtifactReturns,
  deleteFileFromArtifactArgs,
  deleteFileFromArtifactHandler,
  deleteFileFromArtifactReturns,
  renameFileInArtifactArgs,
  renameFileInArtifactHandler,
  renameFileInArtifactReturns,
  updateFileInArtifactArgs,
  updateFileInArtifactHandler,
  updateFileInArtifactReturns,
} from './handlers/content_edits';
import {
  addArtifactPackagesArgs,
  addArtifactPackagesHandler,
  addArtifactPackagesReturns,
  appendArtifactRunOutputArgs,
  appendArtifactRunOutputHandler,
  appendArtifactRunOutputReturns,
  finalizeArtifactRunArgs,
  finalizeArtifactRunHandler,
  finalizeArtifactRunReturns,
  initArtifactRunArgs,
  initArtifactRunHandler,
  initArtifactRunReturns,
  patchArtifactRunProgressArgs,
  patchArtifactRunProgressHandler,
  patchArtifactRunProgressReturns,
  setArtifactRunConfigArgs,
  setArtifactRunConfigHandler,
  setArtifactRunConfigReturns,
} from './handlers/run_state';
import {
  abortStreamArgs,
  abortStreamHandler,
  abortStreamReturns,
  beginEditStreamArgs,
  beginEditStreamHandler,
  beginEditStreamReturns,
  cleanupStaleStreamsArgs,
  cleanupStaleStreamsHandler,
  cleanupStaleStreamsReturns,
  discardActiveStreamsForThreadArgs,
  discardActiveStreamsForThreadHandler,
  discardActiveStreamsForThreadReturns,
  updateRewriteStreamingContentArgs,
  updateRewriteStreamingContentHandler,
  updateRewriteStreamingContentReturns,
} from './handlers/streaming';

// Re-export cross-module helpers so existing callers keep resolving.
export {
  MAX_ARTIFACT_BYTES,
  assertAggregateSize,
  assertContentSize,
} from './handlers/shared';
export { applyFinalizeArtifactRun } from './handlers/run_state';

// =============================================================================
// Content edits
// =============================================================================

export const createArtifact = internalMutation({
  args: createArtifactArgs,
  returns: createArtifactReturns,
  handler: createArtifactHandler,
});

export const deleteFileFromArtifact = internalMutation({
  args: deleteFileFromArtifactArgs,
  returns: deleteFileFromArtifactReturns,
  handler: deleteFileFromArtifactHandler,
});

export const renameFileInArtifact = internalMutation({
  args: renameFileInArtifactArgs,
  returns: renameFileInArtifactReturns,
  handler: renameFileInArtifactHandler,
});

export const createFileInArtifact = internalMutation({
  args: createFileInArtifactArgs,
  returns: createFileInArtifactReturns,
  handler: createFileInArtifactHandler,
});

export const updateFileInArtifact = internalMutation({
  args: updateFileInArtifactArgs,
  returns: updateFileInArtifactReturns,
  handler: updateFileInArtifactHandler,
});

// =============================================================================
// Streaming lifecycle
// =============================================================================

export const beginEditStream = internalMutation({
  args: beginEditStreamArgs,
  returns: beginEditStreamReturns,
  handler: beginEditStreamHandler,
});

export const abortStream = internalMutation({
  args: abortStreamArgs,
  returns: abortStreamReturns,
  handler: abortStreamHandler,
});

export const updateRewriteStreamingContent = internalMutation({
  args: updateRewriteStreamingContentArgs,
  returns: updateRewriteStreamingContentReturns,
  handler: updateRewriteStreamingContentHandler,
});

export const discardActiveStreamsForThread = internalMutation({
  args: discardActiveStreamsForThreadArgs,
  returns: discardActiveStreamsForThreadReturns,
  handler: discardActiveStreamsForThreadHandler,
});

export const cleanupStaleStreams = internalMutation({
  args: cleanupStaleStreamsArgs,
  returns: cleanupStaleStreamsReturns,
  handler: cleanupStaleStreamsHandler,
});

// =============================================================================
// Runnable-artifact run state
// =============================================================================

export const setArtifactRunConfig = internalMutation({
  args: setArtifactRunConfigArgs,
  returns: setArtifactRunConfigReturns,
  handler: setArtifactRunConfigHandler,
});

export const addArtifactPackages = internalMutation({
  args: addArtifactPackagesArgs,
  returns: addArtifactPackagesReturns,
  handler: addArtifactPackagesHandler,
});

export const initArtifactRun = internalMutation({
  args: initArtifactRunArgs,
  returns: initArtifactRunReturns,
  handler: initArtifactRunHandler,
});

export const appendArtifactRunOutput = internalMutation({
  args: appendArtifactRunOutputArgs,
  returns: appendArtifactRunOutputReturns,
  handler: appendArtifactRunOutputHandler,
});

export const patchArtifactRunProgress = internalMutation({
  args: patchArtifactRunProgressArgs,
  returns: patchArtifactRunProgressReturns,
  handler: patchArtifactRunProgressHandler,
});

export const finalizeArtifactRun = internalMutation({
  args: finalizeArtifactRunArgs,
  returns: finalizeArtifactRunReturns,
  handler: finalizeArtifactRunHandler,
});
