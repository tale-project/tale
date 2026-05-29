import { anyApi } from 'convex/server';

import { convexErrorCode } from '../errors';
import { buildDavPath, lockKeyFromParsed } from '../paths';
import type {
  AuthContext,
  ParsedPath,
  WebDAVCtx,
  WebDAVRequest,
  WebDAVResponse,
} from '../types';
import {
  parseIfHeaderTokens,
  parseLockBody,
  parseTimeoutHeader,
} from '../xml/lock-request';
import { buildLockResponse } from '../xml/lock-response';

const DEFAULT_TIMEOUT_SEC = 600; // 10 min if client doesn't specify
const MAX_TIMEOUT_SEC = 60 * 60; // 1h cap

export async function handleLock(
  req: WebDAVRequest,
  ctx: WebDAVCtx,
  auth: AuthContext,
  parsed: ParsedPath,
): Promise<WebDAVResponse> {
  if (parsed.namespace === '.trash') {
    return { status: 403, headers: {}, body: 'Trash is read-only' };
  }
  if (parsed.segments.length === 0) {
    return { status: 403, headers: {}, body: 'Cannot lock root' };
  }

  const body = await req.readText();
  const lockInfo = parseLockBody(body);
  const timeoutSec = clampTimeout(
    parseTimeoutHeader(req.headers.get('timeout')),
  );

  // Refresh path: LOCK with If: header + empty body.
  if (!lockInfo) {
    const tokens = parseIfHeaderTokens(req.headers.get('if'));
    if (tokens.length === 0) {
      return {
        status: 400,
        headers: {},
        body: 'Missing If: header for refresh',
      };
    }
    try {
      for (const token of tokens) {
        const existing = await ctx.convex.query(
          anyApi.webdav.lock_queries.findLockByToken,
          { token },
        );
        if (!existing || existing.organizationId !== auth.organizationId) {
          continue;
        }
        const refreshed = await ctx.convex.mutation(
          anyApi.webdav.lock_mutations.refreshLock,
          { lockToken: token, timeoutMs: timeoutSec * 1000 },
        );
        return buildLockOkResponse(
          token,
          { ownerXml: '', scope: 'exclusive' },
          parsed,
          auth,
          Math.round((refreshed.expiresAt - Date.now()) / 1000),
        );
      }
    } catch (err) {
      console.error('[webdav] LOCK refresh failed', err);
      return { status: 500, headers: {}, body: 'Refresh failed' };
    }
    return { status: 412, headers: {}, body: 'Lock token not found' };
  }

  // Fresh LOCK
  const lockToken = randomUuid();
  const lockKey = lockKeyFromParsed(parsed);

  try {
    await ctx.convex.mutation(anyApi.webdav.lock_mutations.createLock, {
      organizationId: auth.organizationId,
      resourcePath: lockKey,
      lockToken,
      ownerXml: lockInfo.ownerXml,
      depth: parsed.isCollection ? 'infinity' : '0',
      scope: lockInfo.scope,
      ownerUserId: auth.userId,
      appPasswordId: auth.appPasswordId,
      timeoutMs: timeoutSec * 1000,
    });
  } catch (err) {
    if (convexErrorCode(err) === 'LOCKED') {
      return { status: 423, headers: {}, body: 'Already locked' };
    }
    console.error('[webdav] LOCK create failed', err);
    return { status: 500, headers: {}, body: 'Internal error' };
  }

  return buildLockOkResponse(lockToken, lockInfo, parsed, auth, timeoutSec);
}

function buildLockOkResponse(
  lockToken: string,
  lockInfo: { ownerXml: string; scope: 'exclusive' | 'shared' },
  parsed: ParsedPath,
  auth: AuthContext,
  timeoutSec: number,
): WebDAVResponse {
  const href = buildDavPath({
    orgSlug: auth.orgSlug,
    namespace: parsed.namespace,
    segments: parsed.segments,
    isCollection: parsed.isCollection,
  });
  return {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Lock-Token': `<opaquelocktoken:${lockToken}>`,
    },
    body: buildLockResponse({
      scope: lockInfo.scope,
      ownerXml: lockInfo.ownerXml,
      depth: parsed.isCollection ? 'infinity' : '0',
      timeoutSeconds: timeoutSec,
      lockToken,
      href,
    }),
  };
}

function clampTimeout(raw: number | null): number {
  if (raw === null) return DEFAULT_TIMEOUT_SEC;
  if (raw < 1) return DEFAULT_TIMEOUT_SEC;
  return Math.min(raw, MAX_TIMEOUT_SEC);
}

function randomUuid(): string {
  // Web Crypto is available in both Node (>=19) and Vite dev runtime.
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Fallback for older runtimes — shouldn't be reached given Node 19+.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(
    '',
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
