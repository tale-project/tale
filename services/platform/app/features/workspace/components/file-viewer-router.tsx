'use client';

import { Stack } from '@tale/ui/layout';
import { SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Spinner } from '@tale/ui/spinner';
import { Text } from '@tale/ui/text';
import { memo, useEffect, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import {
  getFileExtensionLower,
  isTextBasedFile,
} from '@/lib/utils/text-file-types';

import { useThreadFileContent } from '../hooks/use-thread-file-content';
import { AttachmentViewer } from '../viewers/attachment-viewer';
import { CodeFileViewer } from '../viewers/code-file-viewer';
import { ImageViewer } from '../viewers/image-viewer';
import { RenderableFileViewer } from '../viewers/renderable-file-viewer';

interface FileViewerRouterProps {
  threadId: string | undefined;
  organizationId: string;
  path: string | null;
  /**
   * When set, bypasses the storage fetch and renders this content directly.
   * Used during streaming `file_write` tool calls before the file lands.
   */
  liveContent?: string;
  /**
   * Defaults to `'utf-8'`. For `'base64'`, we don't preview content — show
   * a "Writing…" placeholder until the file lands.
   */
  liveEncoding?: 'utf-8' | 'base64';
}

type RenderKind =
  | 'image'
  | 'attachment'
  | 'html'
  | 'svg'
  | 'mermaid'
  | 'markdown'
  | 'code';

const IMAGE_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'ico',
  'avif',
]);

function resolveKind(
  hint: string | undefined,
  path: string,
  contentType: string | undefined,
): RenderKind {
  if (
    hint === 'image' ||
    hint === 'attachment' ||
    hint === 'html' ||
    hint === 'svg' ||
    hint === 'mermaid' ||
    hint === 'markdown' ||
    hint === 'code'
  ) {
    return hint;
  }
  const ext = getFileExtensionLower(path);
  if (IMAGE_EXTS.has(ext) || contentType?.startsWith('image/')) return 'image';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'svg') return 'svg';
  if (ext === 'mmd' || ext === 'mermaid') return 'mermaid';
  if (ext === 'md' || ext === 'mdx' || ext === 'markdown') return 'markdown';
  if (!isTextBasedFile(path, contentType)) return 'attachment';
  return 'code';
}

function FileViewerRouterComponent({
  threadId,
  organizationId,
  path,
  liveContent,
  liveEncoding = 'utf-8',
}: FileViewerRouterProps) {
  const { t } = useT('chat');
  const isLive = liveContent !== undefined;
  // Disable the storage fetch while we're in live-streaming mode — there's
  // nothing in `_storage` yet and we have the content in-memory.
  const result = useThreadFileContent({
    threadId,
    organizationId,
    path: isLive ? null : path,
  });

  // Bridge the live → landed transition: when the stream ends, `liveContent`
  // disappears but `useThreadFileContent` spends a few frames in `loading`
  // before the storage fetch resolves. Without this, the viewer unmounts to
  // the skeleton in between and the scroll position is lost on remount.
  const [sticky, setSticky] = useState<{
    path: string;
    content: string;
    encoding: 'utf-8' | 'base64';
  } | null>(null);

  useEffect(() => {
    if (path && liveContent !== undefined) {
      setSticky({ path, content: liveContent, encoding: liveEncoding });
    }
  }, [path, liveContent, liveEncoding]);

  useEffect(() => {
    if (!sticky) return;
    if (sticky.path !== path) {
      setSticky(null);
      return;
    }
    if (liveContent === undefined && result.status !== 'loading') {
      setSticky(null);
    }
  }, [sticky, path, liveContent, result.status]);

  const stickyForPath =
    !isLive && sticky?.path === path && result.status === 'loading'
      ? sticky
      : null;
  const renderLive = isLive || stickyForPath !== null;
  const renderContent = isLive
    ? liveContent
    : (stickyForPath?.content ?? undefined);
  const renderEncoding = isLive
    ? liveEncoding
    : (stickyForPath?.encoding ?? liveEncoding);

  if (!path) {
    return (
      <Stack gap={2} className="h-full items-center justify-center p-8">
        <Text variant="muted" className="text-sm">
          {t('canvas.noFile')}
        </Text>
      </Stack>
    );
  }

  if (renderLive) {
    if (renderEncoding === 'base64') {
      return (
        <Stack gap={3} className="h-full items-center justify-center p-8">
          <Spinner />
          <Text variant="caption" className="font-mono">
            {path}
          </Text>
          <Text variant="muted" className="text-sm">
            {t('canvas.writing', { defaultValue: 'Writing…' })}
          </Text>
        </Stack>
      );
    }
    const kind = resolveKind(undefined, path, undefined);
    const text = renderContent ?? '';
    if (
      kind === 'html' ||
      kind === 'svg' ||
      kind === 'mermaid' ||
      kind === 'markdown'
    ) {
      return (
        <RenderableFileViewer
          kind={kind}
          path={path}
          content={text}
          isStreaming={isLive}
        />
      );
    }
    // `image` and `attachment` paths never get here for utf-8 streaming —
    // a binary file should have `liveEncoding === 'base64'`. Fall back to
    // CodeFileViewer so the bytes at least render rather than silently nothing.
    return <CodeFileViewer path={path} content={text} />;
  }

  if (result.status === 'loading') {
    return (
      <Skeletonize loading className="flex h-full flex-col gap-2 p-4 text-sm">
        <SkeletonText lines={4} lastLineWidth="75%" />
      </Skeletonize>
    );
  }

  const kind = resolveKind(result.renderHint, path, result.contentType);

  if (result.status === 'error' && result.error === 'too_large' && result.url) {
    return (
      <AttachmentViewer
        path={path}
        size={result.size ?? 0}
        contentType={result.contentType ?? 'application/octet-stream'}
        url={result.url}
      />
    );
  }

  if (result.status === 'error') {
    if (kind === 'attachment' && result.url) {
      return (
        <AttachmentViewer
          path={path}
          size={result.size ?? 0}
          contentType={result.contentType ?? 'application/octet-stream'}
          url={result.url}
        />
      );
    }
    return (
      <Stack gap={2} className="h-full items-center justify-center p-8">
        <Text variant="muted" className="text-sm">
          {t('canvas.error', {
            defaultValue: 'Could not load this file.',
          })}
        </Text>
      </Stack>
    );
  }

  if (kind === 'image' && result.url) {
    const filename = path.split('/').pop() ?? path;
    return <ImageViewer url={result.url} alt={filename} size={result.size} />;
  }

  if (kind === 'attachment') {
    return (
      <AttachmentViewer
        path={path}
        size={result.size ?? 0}
        contentType={result.contentType ?? 'application/octet-stream'}
        url={result.url ?? ''}
      />
    );
  }

  const text = result.text ?? '';

  if (
    kind === 'html' ||
    kind === 'svg' ||
    kind === 'mermaid' ||
    kind === 'markdown'
  ) {
    return (
      <RenderableFileViewer
        kind={kind}
        path={path}
        content={text}
        isStreaming={false}
      />
    );
  }

  return <CodeFileViewer path={path} content={text} />;
}

export const FileViewerRouter = memo(FileViewerRouterComponent);
