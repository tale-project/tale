'use client';

import { EmptyState } from '@tale/ui/empty-state';
import { Center } from '@tale/ui/layout';
import { Image } from 'lucide-react';
import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';
import {
  getDocumentPreviewKind,
  mimeToExtension,
} from '@/lib/shared/file-types';
import { getFileExtension } from '@/lib/utils/document-helpers';
import { lazyComponent } from '@/lib/utils/lazy-component';
import { isTextBasedFile } from '@/lib/utils/text-file-types';

import { PreviewPaneSkeleton } from './preview-pane';

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

  // Binary formats route via the shared extension → renderer map so the
  // upload-accept and preview-support lists share one definition (#2380).
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

  if (isTextBasedFile(fileName || url, mimeType)) {
    return <DocumentPreviewText url={url} fileName={fileName} />;
  }

  // Unpreviewable types (e.g. PPT/PPTX) fall through here. Downloading is
  // owned by the single Download button in the preview dialog header, so this
  // state stays informational — no competing download button/toast.
  return (
    <Center className="flex-1 p-6">
      <EmptyState
        icon={Image}
        title={t('preview.notAvailable')}
        description={t('preview.notAvailableDescription')}
      />
    </Center>
  );
}
