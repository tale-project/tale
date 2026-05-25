'use client';

import { Stack } from '@tale/ui/layout';
import { Skeleton } from '@tale/ui/skeleton';
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
}: FileViewerRouterProps) {
  const { t } = useT('chat');
  const result = useThreadFileContent({ threadId, organizationId, path });

  if (!path) {
    return (
      <Stack gap={2} className="h-full items-center justify-center p-8">
        <Text variant="muted" className="text-sm">
          {t('canvas.noFile', { defaultValue: 'No file selected' })}
        </Text>
      </Stack>
    );
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
