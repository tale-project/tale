'use client';

import { ActionRow } from '@tale/ui/action-row';
import { Button } from '@tale/ui/button';
import { Heading } from '@tale/ui/heading';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { IconButton } from '@tale/ui/icon-button';
import { HStack } from '@tale/ui/layout';
import { Separator } from '@tale/ui/separator';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { Download, X, Loader2 } from 'lucide-react';
import { useState, useMemo } from 'react';

import { DocumentIcon } from '@/app/components/ui/data-display/document-icon';
import { Dialog } from '@/app/components/ui/dialog/dialog';
import { useFileUrl } from '@/app/features/chat/hooks/queries';
import { useLegalHoldByTarget } from '@/app/features/settings/governance/hooks/queries';
import { LegalHoldBadge } from '@/app/features/settings/governance/legal-hold/legal-hold-badge';
import { useTeams } from '@/app/features/settings/teams/hooks/queries';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { useToast } from '@/app/hooks/use-toast';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';
import { formatBytes } from '@/lib/utils/format/number';

import type { Document } from '../hooks/queries';
import { useDocuments } from '../hooks/queries';
import { DocumentPreview } from './document-preview';
import { PreviewPaneSkeleton } from './preview-pane';
import { RagStatusBadge } from './rag-status-badge';

interface DocumentPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  documentId?: string;
  /** Convex storage ID — used when documentId is not available (e.g. citation source cards). */
  fileId?: string;
  fileName?: string;
}

function SidebarRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <Text variant="label-sm" className="text-muted-foreground">
        {label}
      </Text>
      <div className="text-foreground text-[13px] leading-snug">{children}</div>
    </div>
  );
}

// Masked placeholder values rendered while the metadata is still loading, so
// the sidebar renders its real row structure with masked leaves rather than a
// separate skeleton component.
const PLACEHOLDER_NAME = 'Document name.pdf';
const PLACEHOLDER_SIZE = 0;

function DetailsSidebar({
  doc,
  loading,
}: {
  /** Undefined while the metadata is still loading; rows render masked. */
  doc?: Document;
  loading?: boolean;
}) {
  const { t } = useT('documents');
  const { formatDate } = useFormatDate();
  const { locale } = useLocale();
  const { teams } = useTeams();
  const organizationId = useOrganizationId();
  const { data: legalHold } = useLegalHoldByTarget({
    organizationId: organizationId ?? undefined,
    targetType: 'document',
    targetId: doc?.id,
  });

  const teamNames = useMemo(() => {
    const ids = doc?.teamIds ?? [];
    if (ids.length === 0 || !teams) return [];
    return ids
      .map(
        (id: string) =>
          teams.find((entry: { id: string; name: string }) => entry.id === id)
            ?.name,
      )
      .filter(Boolean);
  }, [doc?.teamIds, teams]);

  const sourceLabel = useMemo(() => {
    const labels: Record<string, string> = {
      upload: t('preview.sidebar.sourceUpload'),
      onedrive: t('preview.sidebar.sourceOnedrive'),
      sharepoint: t('preview.sidebar.sourceSharepoint'),
    };
    return labels[doc?.sourceProvider ?? 'upload'] ?? doc?.sourceProvider;
  }, [doc?.sourceProvider, t]);

  const modifiedDate = useMemo(() => {
    if (!doc?.lastModified) return undefined;
    return formatDate(new Date(doc.lastModified), 'short');
  }, [doc?.lastModified, formatDate]);

  return (
    <Skeletonize
      loading={loading ?? false}
      label={t('preview.sidebar.document')}
      className="contents"
    >
      <aside
        className="flex w-[220px] shrink-0 flex-col gap-3 overflow-y-auto"
        aria-label={t('preview.sidebar.document')}
      >
        <SidebarRow label={t('preview.sidebar.document')}>
          <HStack gap={2} className="items-center">
            <DocumentIcon fileName={doc?.name ?? ''} className="w-4" />
            <span className="truncate">
              <SkeletonBox>{doc?.name ?? PLACEHOLDER_NAME}</SkeletonBox>
            </span>
          </HStack>
        </SidebarRow>

        {loading || doc?.size != null ? (
          <SidebarRow label={t('preview.sidebar.size')}>
            <SkeletonBox>
              {formatBytes(doc?.size ?? PLACEHOLDER_SIZE, locale)}
            </SkeletonBox>
          </SidebarRow>
        ) : null}

        <SidebarRow label={t('preview.sidebar.source')}>
          <SkeletonBox>{sourceLabel}</SkeletonBox>
        </SidebarRow>

        <Separator />

        <SidebarRow label={t('preview.sidebar.ragStatus')}>
          <HStack gap={2} className="flex-wrap items-center">
            <SkeletonBox>
              <RagStatusBadge
                status={doc?.ragStatus}
                indexedAt={doc?.ragIndexedAt}
                error={doc?.ragError}
                documentId={doc?.id}
              />
            </SkeletonBox>
            <LegalHoldBadge hold={legalHold} />
          </HStack>
        </SidebarRow>

        {doc?.scannedPagesDetected != null && doc.scannedPagesDetected > 0 && (
          <SidebarRow label={t('preview.sidebar.imagePages')}>
            {String(doc.scannedPagesDetected)}
            {doc.ragStatus === 'completed' && doc.ocrApplied != null && (
              <Text variant="label-sm" className="text-muted-foreground">
                {doc.ocrApplied
                  ? t('ocr.processingWithOcr')
                  : t('ocr.unavailable')}
              </Text>
            )}
          </SidebarRow>
        )}

        <Separator />

        {teamNames.length > 0 && (
          <SidebarRow label={t('preview.sidebar.teams')}>
            {teamNames.join(', ')}
          </SidebarRow>
        )}

        {doc?.createdByName && (
          <SidebarRow label={t('preview.sidebar.uploadedBy')}>
            {doc.createdByName}
          </SidebarRow>
        )}

        {modifiedDate && (
          <>
            <Separator />
            <SidebarRow label={t('preview.sidebar.modified')}>
              {modifiedDate}
            </SidebarRow>
          </>
        )}
      </aside>
    </Skeletonize>
  );
}

export function DocumentPreviewDialog({
  open,
  onOpenChange,
  organizationId,
  documentId,
  fileId,
  fileName,
}: DocumentPreviewDialogProps) {
  const { t } = useT('documents');
  const [isDownloading, setIsDownloading] = useState(false);
  const { toast } = useToast();

  const { documents, isLoading: isLoadingDocs } = useDocuments(organizationId);

  const doc = useMemo(() => {
    if (!documents || !open) return undefined;
    if (documentId) {
      return documents.find((d: Document) => d.id === documentId);
    }
    return undefined;
  }, [documents, open, documentId]);

  // When no documentId is available, resolve fileId (storage ID) directly to a URL
  const { data: storageUrl, isLoading: isLoadingUrl } = useFileUrl(
    !documentId && fileId ? toId<'_storage'>(fileId) : undefined,
    !open,
  );

  const resolvedUrl = doc?.url ?? storageUrl ?? undefined;
  const isLoading = documentId ? isLoadingDocs : isLoadingUrl;
  const displayName = fileName || doc?.name || t('preview.document');

  const handleDownload = async () => {
    if (!resolvedUrl) return;

    try {
      setIsDownloading(true);

      const response = await fetch(resolvedUrl);
      if (!response.ok) throw new Error(t('preview.downloadFailed'));

      const blob = await response.blob();

      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = displayName;
      document.body.appendChild(link);
      link.click();

      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);

      toast({
        title: t('preview.downloadComplete'),
        description: t('preview.downloadedSuccessfully', {
          filename: displayName,
        }),
        variant: 'success',
      });
    } catch (error) {
      console.error('Download error:', error);
      toast({
        title: t('preview.failedToLoad'),
        variant: 'destructive',
      });
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('preview.title')}
      size="wide"
      hideClose
      className="flex h-[85vh] flex-col overflow-hidden p-0 sm:p-0"
      customHeader={
        <div className="flex max-h-[4.5rem] flex-row items-center justify-between p-5">
          <Heading level={2} tracking="tight" className="leading-none">
            {t('preview.title')}
          </Heading>

          <ActionRow gap={2}>
            {resolvedUrl && (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleDownload}
                disabled={isDownloading}
                aria-label={t('preview.downloadFile')}
              >
                {isDownloading ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : (
                  <Download className="mr-1.5 size-3.5" />
                )}
                {t('preview.download')}
              </Button>
            )}
            <IconButton
              icon={X}
              aria-label={t('preview.closePreview')}
              onClick={() => onOpenChange(false)}
            />
          </ActionRow>
        </div>
      }
    >
      {!isLoading && !resolvedUrl && open ? (
        <div className="grid flex-1 place-items-center p-6">
          <Text as="div" variant="error">
            {t('preview.failedToLoad')}
          </Text>
        </div>
      ) : (
        // Single two-column shell (preview pane + metadata sidebar) for both the
        // loading and loaded states, so the document swaps in without the
        // layout jumping. The preview pane keeps the lazy/inflight
        // `PreviewPaneSkeleton` fallback until a URL resolves; the sidebar
        // renders its real structure with masked leaves while loading.
        <div className="flex h-full min-h-0 gap-5 px-5 pb-5">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {resolvedUrl ? (
              <DocumentPreview url={resolvedUrl} fileName={displayName} />
            ) : (
              <PreviewPaneSkeleton />
            )}
          </div>
          {/* The metadata sidebar only renders when a `documentId` is in play;
              gate it the same way so the citation-card (fileId-only) path isn't
              given a column it never fills. */}
          {documentId && <DetailsSidebar doc={doc} loading={isLoading} />}
        </div>
      )}
    </Dialog>
  );
}
