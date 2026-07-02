'use node';

/**
 * Ephemeral render session for the crawler: run a self-contained Playwright
 * script in a throwaway sandbox SESSION (create → run → read output → destroy) —
 * the session-model replacement for the retired one-shot `/v1/execute` render
 * path. Renders draw from the isolated per-org 'render' session budget so heavy
 * crawling can't starve interactive agent / run_code sessions.
 */

import type { GenericActionCtx } from 'convex/server';

import { internal } from '../../_generated/api';
import type { DataModel, Id } from '../../_generated/dataModel';
import { toSandboxStorageUrl } from '../../lib/helpers/public_storage_url';
import {
  SessionDuplicateError,
  sessionCreate,
  sessionDestroy,
  sessionReadFile,
  sessionStageFiles,
} from '../../node_only/sandbox/helpers/session_client';
import { runStepsInSession } from '../../node_only/sandbox/session_exec';
import { sessionIdForRender } from '../../sandbox/session_naming';

const RENDER_OUTPUT_DIR = '/user/output';

export interface RenderOutput {
  bytes: ArrayBuffer;
  contentType: string;
  size: number;
}

/**
 * Run `scriptContent` — a Node/Playwright render script that writes its result
 * to `/user/output/<outputFileName>` — in an ephemeral render session and return
 * the output file's bytes. Throws on reserve/create failure (at capacity the
 * per-org 'render' budget hard-fails → the caller falls back to a plain fetch)
 * or a non-completed run. The session + the transient script blob are always
 * torn down.
 */
export async function renderInSession(
  ctx: GenericActionCtx<DataModel>,
  args: {
    organizationId: string;
    /** Unique key for this render (a synthetic id) — seeds the session id +
     * per-owner scope so concurrent renders never collide. */
    renderKey: string;
    scriptContent: string;
    outputFileName: string;
    timeoutMs: number;
    /** Log-line prefix (e.g. 'crawler' / 'documents'). */
    logTag: string;
  },
): Promise<RenderOutput> {
  const sessionId = sessionIdForRender(args.renderKey);

  // Stage the render script as a Convex storage blob → internal http(s) URL (the
  // spawner's input-fetch requires an http(s) URL ≤4096 chars; a data: URL is
  // rejected). Always cleaned up in the `finally`.
  const scriptStorageId = await ctx.storage.store(
    new Blob([args.scriptContent], { type: 'text/javascript' }),
  );

  let rowId: Id<'sandboxSessions'> | null = null;
  try {
    const rawScriptUrl = await ctx.storage.getUrl(scriptStorageId);
    if (!rawScriptUrl) {
      throw new Error('failed to mint render-script storage url');
    }
    const scriptUrl = toSandboxStorageUrl(rawScriptUrl);

    // Reserve WITHOUT a park ticket — a render at the per-org 'render' cap
    // hard-fails (QUOTA_EXCEEDED) rather than queueing; the caller falls back.
    rowId = await ctx.runMutation(
      internal.sandbox.session_mutations.reserveSessionSlotAndInsert,
      {
        organizationId: args.organizationId,
        sessionId,
        profile: 'default',
        ownerType: 'render',
        ownerId: args.renderKey,
        createdBy: 'crawler',
      },
    );
    try {
      await sessionCreate({
        sessionId,
        organizationId: args.organizationId,
        profile: 'default',
      });
    } catch (createErr) {
      // A deterministic-id collision can only be an orphan (the reserve
      // serializes platform-side creation) — reap and retry once.
      if (!(createErr instanceof SessionDuplicateError)) throw createErr;
      await sessionDestroy(sessionId);
      await sessionCreate({
        sessionId,
        organizationId: args.organizationId,
        profile: 'default',
      });
    }
    await ctx.runMutation(internal.sandbox.session_mutations.setSessionStatus, {
      rowId,
      status: 'active',
      lastActivityAt: Date.now(),
    });

    await sessionStageFiles(sessionId, [
      { path: 'code/render.js', url: scriptUrl },
    ]);

    const run = await runStepsInSession(sessionId, {
      stepPaths: ['/user/code/render.js'],
      timeoutMs: args.timeoutMs,
    });
    if (run.status !== 'completed') {
      const tail = run.stderr.trim().slice(-800);
      throw new Error(
        `sandbox render did not complete (status=${run.status}${
          tail ? `; stderr: …${tail}` : ''
        })`,
      );
    }

    const read = await sessionReadFile(
      sessionId,
      `${RENDER_OUTPUT_DIR}/${args.outputFileName}`,
    );
    if (read === null) {
      throw new Error(`sandbox render produced no ${args.outputFileName}`);
    }
    const buf = Buffer.from(read.bytes);
    const ab = new ArrayBuffer(buf.byteLength);
    new Uint8Array(ab).set(buf);
    return { bytes: ab, contentType: read.contentType, size: buf.byteLength };
  } finally {
    if (rowId !== null) {
      try {
        await sessionDestroy(sessionId);
      } catch (err) {
        console.warn(`[${args.logTag}] render session destroy failed:`, err);
      }
      try {
        await ctx.runMutation(
          internal.sandbox.session_mutations.markSessionRowDestroyed,
          { organizationId: args.organizationId, sessionId },
        );
      } catch (err) {
        console.warn(
          `[${args.logTag}] render session row destroy failed:`,
          err,
        );
      }
    }
    try {
      await ctx.storage.delete(scriptStorageId);
    } catch (err) {
      console.warn(`[${args.logTag}] render-script blob delete failed:`, err);
    }
  }
}
