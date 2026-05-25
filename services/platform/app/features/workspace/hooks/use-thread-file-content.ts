'use client';

import { useQuery } from 'convex/react';
import { useEffect, useState } from 'react';

import { api } from '@/convex/_generated/api';

interface UseThreadFileContentArgs {
  threadId: string | undefined;
  organizationId: string;
  path: string | null;
}

interface ThreadFileContentResult {
  /** Decoded text body (undefined for binary content or while loading). */
  text?: string;
  /** Raw signed URL — image / attachment viewers reference it directly. */
  url?: string;
  size?: number;
  contentType?: string;
  renderHint?:
    | 'html'
    | 'svg'
    | 'mermaid'
    | 'markdown'
    | 'code'
    | 'image'
    | 'attachment';
  /** `loading` until the URL resolves or the fetch finishes. */
  status: 'idle' | 'loading' | 'ready' | 'error';
  error?: string;
}

const TEXT_PREVIEW_LIMIT = 5 * 1024 * 1024; // 5 MB

/**
 * Subscribes to the per-file signed URL via Convex and (for text-ish
 * content) fetches the body so viewers can render synchronously. Binary
 * files (image / attachment) stop at the URL — the viewer hands the URL
 * directly to `<img>` / `<a>`.
 */
export function useThreadFileContent({
  threadId,
  organizationId,
  path,
}: UseThreadFileContentArgs): ThreadFileContentResult {
  const meta = useQuery(
    api.thread_files.queries.getThreadFileContentUrl,
    threadId && path ? { threadId, organizationId, path } : 'skip',
  );

  const [body, setBody] = useState<{
    url: string;
    text?: string;
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (!meta || !path) {
      setBody(null);
      return undefined;
    }
    // Image / attachment renderers don't need the body text — skip the
    // fetch to save bandwidth (a 4 MB PNG would otherwise come over the
    // wire twice on every refocus).
    const isBinaryHint =
      meta.renderHint === 'image' || meta.renderHint === 'attachment';
    if (isBinaryHint) {
      setBody({ url: meta.url });
      return undefined;
    }
    let cancelled = false;
    setBody(null);
    void (async () => {
      try {
        const res = await fetch(meta.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // Guard against accidentally downloading a 100 MB asset as text.
        const cl = Number(res.headers.get('content-length') ?? meta.size ?? 0);
        if (cl > TEXT_PREVIEW_LIMIT) {
          if (!cancelled) setBody({ url: meta.url, error: 'too_large' });
          return;
        }
        const text = await res.text();
        if (!cancelled) setBody({ url: meta.url, text });
      } catch (err) {
        if (!cancelled) {
          setBody({
            url: meta.url,
            error: err instanceof Error ? err.message : 'fetch_failed',
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [meta, path]);

  if (!path) return { status: 'idle' };
  if (meta === undefined) return { status: 'loading' };
  if (meta === null) return { status: 'error', error: 'not_found' };
  if (body === null) {
    return {
      status: 'loading',
      url: meta.url,
      size: meta.size,
      contentType: meta.contentType,
      renderHint: meta.renderHint,
    };
  }
  if (body.error) {
    return {
      status: 'error',
      error: body.error,
      url: meta.url,
      size: meta.size,
      contentType: meta.contentType,
      renderHint: meta.renderHint,
    };
  }
  return {
    status: 'ready',
    text: body.text,
    url: body.url,
    size: meta.size,
    contentType: meta.contentType,
    renderHint: meta.renderHint,
  };
}
