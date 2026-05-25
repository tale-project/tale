'use client';

import { Stack } from '@tale/ui/layout';
import { Skeleton } from '@tale/ui/skeleton';
import { Spinner } from '@tale/ui/spinner';
import { Text } from '@tale/ui/text';
import { memo } from 'react';

import { useT } from '@/lib/i18n/client';
import {
  getFileExtensionLower,
  isTextBasedFile,
} from '@/lib/utils/text-file-types';

import { useThreadFileContent } from '../hooks/use-thread-file-content';
import { AttachmentViewer } from '../viewers/attachment-viewer';
import { CodeViewer } from '../viewers/code-viewer';
import { HtmlViewer } from '../viewers/html-viewer';
import { ImageViewer } from '../viewers/image-viewer';
import { MarkdownViewer } from '../viewers/markdown-viewer';
import { MermaidViewer } from '../viewers/mermaid-viewer';
import { SvgViewer } from '../viewers/svg-viewer';

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

  if (!path) {
    return (
      <Stack gap={2} className="h-full items-center justify-center p-8">
        <Text variant="muted" className="text-sm">
          {t('canvas.noFile', { defaultValue: 'No file selected' })}
        </Text>
      </Stack>
    );
  }

  if (isLive) {
    if (liveEncoding === 'base64') {
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
    const text = liveContent ?? '';
    if (kind === 'html') return <HtmlViewer html={text} />;
    if (kind === 'svg') return <SvgViewer svg={text} />;
    if (kind === 'mermaid') return <MermaidViewer code={text} />;
    if (kind === 'markdown') return <MarkdownViewer content={text} />;
    // `image` and `attachment` paths never get here for utf-8 streaming —
    // a binary file should have `liveEncoding === 'base64'`. Fall back to
    // CodeViewer so the bytes at least render rather than silently nothing.
    return <CodeViewer path={path} content={text} showWrapToggle />;
  }

  if (result.status === 'loading') {
    return (
      <div className="flex h-full flex-col gap-2 p-4">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-3/4" />
      </div>
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
    return <ImageViewer url={result.url} alt={filename} />;
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

  if (kind === 'html') {
    return <HtmlViewer html={text} />;
  }

  if (kind === 'svg') {
    return <SvgViewer svg={text} />;
  }

  if (kind === 'mermaid') {
    return <MermaidViewer code={text} />;
  }

  if (kind === 'markdown') {
    return <MarkdownViewer content={text} />;
  }

  return <CodeViewer path={path} content={text} showWrapToggle />;
}

export const FileViewerRouter = memo(FileViewerRouterComponent);
