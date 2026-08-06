'use client';

import { EmptyState } from '@tale/ui/empty-state';
import { Image } from 'lucide-react';
import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';
import {
  getDocumentPreviewKind,
  mimeToExtension,
} from '@/lib/shared/file-types';
import { cn } from '@/lib/utils/cn';
import { getFileExtension } from '@/lib/utils/document-helpers';
import { lazyComponent } from '@/lib/utils/lazy-component';
import { isTextBasedFile } from '@/lib/utils/text-file-types';

import {
  PreviewPane,
  PreviewPaneSkeleton,
  previewPaneReadableClasses,
} from './preview-pane';

// Every preview renders inside `PreviewPane`, so the lazy Suspense fallback is
// the real pane shell (see `PreviewPaneSkeleton`) — the chunk swaps in without
// the panel resizing or recentering.
const DocumentPreviewPDF = lazyComponent(
  () =>
    import('./document-preview-pdf').then((m) => ({
      default: m.DocumentPreviewPDF,
    })),
  {
    loading: () => <PreviewPaneSkeleton />,
  },
);
const DocumentPreviewDocx = lazyComponent(
  () =>
    import('./document-preview-docx').then((m) => ({
      default: m.DocumentPreviewDocx,
    })),
  {
    loading: () => <PreviewPaneSkeleton />,
  },
);
const DocumentPreviewOdt = lazyComponent(
  () =>
    import('./document-preview-odt').then((m) => ({
      default: m.DocumentPreviewOdt,
    })),
  {
    loading: () => <PreviewPaneSkeleton />,
  },
);
const DocumentPreviewXlsx = lazyComponent(
  () =>
    import('./document-preview-xlsx').then((m) => ({
      default: m.DocumentPreviewXlsx,
    })),
  {
    loading: () => <PreviewPaneSkeleton />,
  },
);
const DocumentPreviewText = lazyComponent(
  () =>
    import('./document-preview-text').then((m) => ({
      default: m.DocumentPreviewText,
    })),
  {
    loading: () => <PreviewPaneSkeleton />,
  },
);
const DocumentPreviewMarkdown = lazyComponent(
  () =>
    import('./document-preview-markdown').then((m) => ({
      default: m.DocumentPreviewMarkdown,
    })),
  {
    loading: () => <PreviewPaneSkeleton />,
  },
);
const DocumentPreviewImage = lazyComponent(
  () =>
    import('./document-preview-image').then((m) => ({
      default: m.DocumentPreviewImage,
    })),
  {
    loading: () => <PreviewPaneSkeleton />,
  },
);

export interface DocumentPreviewProps {
  url: string;
  fileName?: string;
  /** Authoritative content type, preferred over the filename suffix so that
   * synced documents with clean, extension-less titles still route correctly. */
  mimeType?: string;
}

export function DocumentPreview({
  url,
  fileName,
  mimeType,
}: DocumentPreviewProps) {
  const { t } = useT('documents');

  // Prefer the authoritative mimeType (synced docs keep clean, extension-less
  // titles), falling back to the filename suffix when the mime is generic.
  const extension = useMemo(() => {
    const fromMime = mimeType ? mimeToExtension(mimeType) : undefined;
    if (fromMime) return fromMime.toUpperCase();
    return getFileExtension(fileName || url);
  }, [fileName, url, mimeType]);

  // Dedicated renderers route via the shared extension → kind map so the
  // upload-accept and preview-support lists share one definition (#2380).
  // Markdown is rendered; other text files fall through to source preview.
  const previewKind = getDocumentPreviewKind(extension);

  if (previewKind === 'pdf') {
    return <DocumentPreviewPDF url={url} />;
  }

  if (previewKind === 'docx') {
    return <DocumentPreviewDocx url={url} />;
  }

  if (previewKind === 'odt') {
    return <DocumentPreviewOdt url={url} />;
  }

  if (previewKind === 'xlsx') {
    return <DocumentPreviewXlsx url={url} />;
  }

  if (previewKind === 'image') {
    return <DocumentPreviewImage url={url} fileName={fileName} />;
  }

  if (previewKind === 'markdown') {
    return <DocumentPreviewMarkdown url={url} />;
  }

  if (isTextBasedFile(fileName || url, mimeType)) {
    return <DocumentPreviewText url={url} fileName={fileName} />;
  }

  // Unpreviewable types (e.g. PPT/PPTX) fall through here. Downloading is
  // owned by the single Download button in the preview dialog header, so this
  // state stays informational — no competing download button/toast.
  return (
    <PreviewPane
      className={cn(previewPaneReadableClasses, 'items-center justify-center')}
    >
      <EmptyState
        icon={Image}
        title={t('preview.notAvailable')}
        description={t('preview.notAvailableDescription')}
      />
    </PreviewPane>
  );
}
