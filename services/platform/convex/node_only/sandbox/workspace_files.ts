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
import {
  sessionBrowserReset,
  sessionIsAlive,
  sessionListFiles,
  sessionReadFile,
} from './helpers/session_client';

/** The agent's working area (Part C) and the explorer's root. We deliberately
 * root at `/agent/workspace`, NOT the `/agent` data root: the panel is "Workspace
 * files", so it shows the agent's working tree (cloned repos, created files) —
 * not the sibling `uploads/`/`output/` I/O dirs or the hidden `.runtime/`. */
const WORKSPACE_ROOT = '/agent/workspace';

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
 * `/agent/.runtime` at the root). Results are sorted dirs-first then alpha and
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
    if (raw === null) {
      // null ⇒ the spawner 404'd: either this directory vanished while the
      // session is still alive, OR the session's backend is gone (the Convex
      // row can read 'active' for a short window after an eviction, before the
      // reconcile sweep flips it). Probe liveness so a dead session surfaces as
      // sessionRunning:false ("resume to browse") instead of a misleading empty
      // listing.
      const alive = await sessionIsAlive(sess.sessionId);
      return { sessionRunning: alive, entries: [], truncated: false };
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
 * Reset the thread's live-browser to a clean profile (the "Reset browser"
 * affordance). This WIPES the persistent browser profile — saved logins are
 * lost — and is the user-driven last resort for a genuinely corrupt/wedged
 * browser that auto-recovery (lock hygiene) couldn't unstick.
 *
 * Same `resolveBrowsableSession` (canAccessThread) boundary as the file
 * explorer, so a threadId from another org throws before any spawner call. A
 * no-running-session thread returns `sessionRunning: false` (nothing to reset).
 */
export const resetThreadBrowser = action({
  args: { threadId: v.string() },
  returns: v.object({
    sessionRunning: v.boolean(),
    ready: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const sess = await ctx.runQuery(
      internal.sandbox.workspace_files.resolveBrowsableSession,
      { threadId: args.threadId },
    );
    if (!sess.sessionId || sess.status !== 'active') {
      return { sessionRunning: false, ready: false };
    }
    const r = await sessionBrowserReset(sess.sessionId);
    return { sessionRunning: true, ready: r.ready };
  },
});

/**
 * Read a single workspace file's raw bytes from the spawner. Node-only (HMAC
 * signing). The CALLER (the `/api/sandbox/workspace_file` httpAction, V8
 * runtime) has already authorized the (thread → session → org) access via
 * `resolveBrowsableSessionForUser` and passes the vetted `sessionId` — this
 * action does NOT re-authorize, so it must never be exposed publicly.
 *
 * Returns a discriminated status: `ok` (bytes), `missing` (the spawner 404'd
 * but the session is alive — path gone OR over runnerd's 20 MB cap, which the
 * spawner conflates), or `gone` (the session backend is gone — phantom row).
 * The httpAction maps gone→409 (resume to browse) and missing→404 so the UI
 * doesn't tell the user a file is "missing" when the sandbox simply stopped.
 */
export const readWorkspaceFileBytes = internalAction({
  args: { sessionId: v.string(), path: v.string() },
  returns: v.union(
    v.object({
      status: v.literal('ok'),
      bytes: v.bytes(),
      contentType: v.string(),
    }),
    v.object({ status: v.literal('missing') }),
    v.object({ status: v.literal('gone') }),
  ),
  handler: async (_ctx, args) => {
    const file = await sessionReadFile(args.sessionId, args.path);
    if (file) {
      return {
        status: 'ok' as const,
        bytes: file.bytes,
        contentType: file.contentType,
      };
    }
    // null ⇒ spawner 404. Probe liveness to tell "file missing/too large"
    // (session alive) apart from "sandbox stopped" (backend gone).
    const alive = await sessionIsAlive(args.sessionId);
    return { status: alive ? ('missing' as const) : ('gone' as const) };
  },
});
