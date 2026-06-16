'use node';

// Public node action for the read-only chat workspace file explorer: list a
// directory in the live external-agent session workspace. Lives in node_only
// because it calls the spawner client (`sessionListFiles`, node-only HMAC
// signing). Authorization + thread→session→org resolution is shared with the
// download httpAction via `sandbox/workspace_files.ts resolveBrowsableSession`
// (the canAccessThread boundary).

import { v } from 'convex/values';

import { internal } from '../../_generated/api';
import { action, internalAction } from '../../_generated/server';
import { sessionListFiles, sessionReadFile } from './helpers/session_client';

/** The agent's working area (Part C) and the explorer's root. We deliberately
 * root at `/user/workspace`, NOT the `/user` data root: the panel is "Workspace
 * files", so it shows the agent's working tree (cloned repos, created files) —
 * not the sibling `uploads/`/`output/` I/O dirs or the hidden `.runtime/`. */
const WORKSPACE_ROOT = '/user/workspace';

/** Hard cap on entries returned for one directory — protects the wire + UI from
 * a pathological directory; `truncated` tells the browser the list was clipped. */
const MAX_ENTRIES = 1000;

/** Names never surfaced regardless of `showHidden` (noise / VCS internals). */
const ALWAYS_HIDDEN = new Set(['node_modules', '.git']);

const fsEntryValidator = v.object({
  name: v.string(),
  type: v.union(v.literal('file'), v.literal('dir'), v.literal('other')),
  size: v.number(),
  mtimeMs: v.number(),
});

/**
 * List a directory in the thread's live session workspace. Read-only.
 *
 * Resolution + auth go through `resolveBrowsableSession` (the canAccessThread
 * boundary) — a threadId from another org throws there before any spawner call.
 * When the session isn't actively running we return `sessionRunning: false` so
 * the UI shows a "resume to browse" affordance rather than an error.
 *
 * Server-side filtering: `node_modules` / `.git` are always dropped; when
 * `showHidden` is false, dot-files are dropped too (this is what hides
 * `/user/.runtime` at the root). Results are sorted dirs-first then alpha and
 * capped at MAX_ENTRIES.
 */
export const listWorkspaceDir = action({
  args: {
    threadId: v.string(),
    path: v.optional(v.string()),
    showHidden: v.optional(v.boolean()),
  },
  returns: v.object({
    sessionRunning: v.boolean(),
    entries: v.array(fsEntryValidator),
    truncated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const dirPath = args.path ?? WORKSPACE_ROOT;
    // Defensive path validation even though runnerd validates — reject path
    // traversal and NUL bytes cheaply before they reach the spawner.
    if (dirPath.includes('..') || dirPath.includes('\u0000')) {
      throw new Error('Invalid path');
    }

    const sess = await ctx.runQuery(
      internal.sandbox.workspace_files.resolveBrowsableSession,
      { threadId: args.threadId },
    );
    if (!sess.sessionId || sess.status !== 'active') {
      return { sessionRunning: false, entries: [], truncated: false };
    }

    const raw = await sessionListFiles(sess.sessionId, dirPath);
    // null ⇒ path (or session) gone spawner-side. The session itself is active,
    // so this is "this directory disappeared", not "no sandbox": still
    // sessionRunning, just an empty listing.
    if (raw === null) {
      return { sessionRunning: true, entries: [], truncated: false };
    }

    const showHidden = args.showHidden === true;
    const filtered = raw.filter((e) => {
      if (ALWAYS_HIDDEN.has(e.name)) return false;
      if (!showHidden && e.name.startsWith('.')) return false;
      return true;
    });

    filtered.sort((a, b) => {
      const aDir = a.type === 'dir';
      const bDir = b.type === 'dir';
      if (aDir !== bDir) return aDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const truncated = filtered.length > MAX_ENTRIES;
    const entries = (truncated ? filtered.slice(0, MAX_ENTRIES) : filtered).map(
      (e) => ({
        name: e.name,
        type: e.type,
        size: e.size,
        mtimeMs: e.mtimeMs,
      }),
    );

    return { sessionRunning: true, entries, truncated };
  },
});

/**
 * Read a single workspace file's raw bytes from the spawner. Node-only (HMAC
 * signing). The CALLER (the `/api/sandbox/workspace_file` httpAction, V8
 * runtime) has already authorized the (thread → session → org) access via
 * `resolveBrowsableSessionForUser` and passes the vetted `sessionId` — this
 * action does NOT re-authorize, so it must never be exposed publicly. Returns
 * null when the path is missing OR over runnerd's 20 MB cap (the spawner
 * conflates both into a 404 → null); the httpAction maps null to 404.
 */
export const readWorkspaceFileBytes = internalAction({
  args: { sessionId: v.string(), path: v.string() },
  returns: v.union(
    v.object({ bytes: v.bytes(), contentType: v.string() }),
    v.null(),
  ),
  handler: async (_ctx, args) => sessionReadFile(args.sessionId, args.path),
});
