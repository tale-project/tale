'use client';

import { ActionRow } from '@tale/ui/action-row';
import { Button } from '@tale/ui/button';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { IconButton } from '@tale/ui/icon-button';
import { HStack, Row, Stack } from '@tale/ui/layout';
import { Separator } from '@tale/ui/separator';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { Download, X, Loader2 } from 'lucide-react';
import { useState, useMemo } from 'react';

import { DocumentIcon } from '@/app/components/ui/data-display/document-icon';
import { Dialog } from '@/app/components/ui/dialog/dialog';
import { useLegalHoldByTarget } from '@/app/features/settings/governance/hooks/queries';
import { LegalHoldBadge } from '@/app/features/settings/governance/legal-hold/legal-hold-badge';
import { useTeams } from '@/app/features/settings/teams/hooks/queries';
import { useFileUrl } from '@/app/features/shared/files/use-file-url';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { useToast } from '@/app/hooks/use-toast';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { formatBytes } from '@/lib/utils/format/number';

import type { Document } from '../hooks/queries';
import { useDocument } from '../hooks/queries';
import { DocumentPreview } from './document-preview';
import { PreviewPaneSkeleton } from './preview-pane';
import { RagStatusBadge } from './rag-status-badge';

interface DocumentPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
    <div className="flex flex-col gap-1">
      <Text as="span" variant="label-sm" className="text-muted-foreground">
        {label}
      </Text>
      <div className="text-foreground text-sm leading-snug">{children}</div>
    </div>
  );
}

function SidebarSection({ children }: { children: React.ReactNode }) {
  return <div className="px-5 py-4">{children}</div>;
}

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

  const hasProvenance =
    teamNames.length > 0 ||
    Boolean(doc?.createdByName) ||
    Boolean(modifiedDate);

  return (
    <Skeletonize
      loading={loading ?? false}
      label={t('preview.sidebar.document')}
      className="bg-background border-border flex h-full min-h-0 flex-col overflow-y-auto border-t"
    >
      <aside
        aria-label={t('preview.sidebar.document')}
        className="flex flex-col"
      >
        <SidebarSection>
          <Stack gap={3}>
            <SidebarRow label={t('preview.sidebar.source')}>
              <SkeletonBox>{sourceLabel}</SkeletonBox>
            </SidebarRow>
          </Stack>
        </SidebarSection>

        <Separator />

        <SidebarSection>
          <Stack gap={3}>
            <SidebarRow label={t('preview.sidebar.ragStatus')}>
              <HStack gap={2} className="flex-wrap items-center">
                <SkeletonBox>
                  <RagStatusBadge
                    status={doc?.ragStatus}
                    indexedAt={doc?.ragIndexedAt}
                    error={doc?.ragError}
                    errorCode={doc?.ragErrorCode}
                    documentId={doc?.id}
                  />
                </SkeletonBox>
                <LegalHoldBadge hold={legalHold} />
              </HStack>
            </SidebarRow>

            {doc?.scannedPagesDetected != null &&
              doc.scannedPagesDetected > 0 && (
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
          </Stack>
        </SidebarSection>

        {hasProvenance && (
          <>
            <Separator />

            <SidebarSection>
              <Stack gap={3}>
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
                  <SidebarRow label={t('preview.sidebar.modified')}>
                    {modifiedDate}
                  </SidebarRow>
                )}
              </Stack>
            </SidebarSection>
          </>
        )}
      </aside>
    </Skeletonize>
  );
}

export function DocumentPreviewDialog({
  open,
  onOpenChange,
  documentId,
  fileId,
  fileName,
}: DocumentPreviewDialogProps) {
  const { t } = useT('documents');
  const { locale } = useLocale();
  const [isDownloading, setIsDownloading] = useState(false);
  const { toast } = useToast();

  const { data: docData, isLoading: isLoadingDoc } = useDocument(
    open && documentId ? documentId : undefined,
  );
  const doc = docData ?? undefined;

  const { data: storageUrl, isLoading: isLoadingUrl } = useFileUrl(
    !documentId && fileId ? toId<'_storage'>(fileId) : undefined,
    !open,
  );

  const resolvedUrl = doc?.url ?? storageUrl ?? undefined;
  const isLoading = documentId ? isLoadingDoc : isLoadingUrl;
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
      className="flex h-[85vh] flex-col gap-0 overflow-hidden border-0 p-0 ring-0 md:p-0"
      customHeader={
        documentId ? (
          <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_260px]">
            <div className="border-border border-b px-5 py-3">
              <HStack gap={3} className="min-w-0">
                <DocumentIcon
                  fileName={displayName}
                  mimeType={doc?.mimeType}
                  className="size-8 shrink-0"
                />
                <Stack gap={1} className="min-w-0">
                  <Text
                    as="span"
                    className="text-foreground truncate text-base leading-tight font-semibold tracking-tight"
                  >
                    {displayName}
                  </Text>
                  {doc?.size != null && (
                    <Text
                      as="span"
                      variant="caption"
                      className="text-muted-foreground"
                    >
                      {formatBytes(doc.size, locale)}
                    </Text>
                  )}
                </Stack>
              </HStack>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3">
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
            </div>
          </div>
        ) : (
          <div className="border-border w-full shrink-0 border-b">
            <Row gap={4} justify="between" className="px-5 py-3">
              <HStack gap={3} className="min-w-0">
                <DocumentIcon
                  fileName={displayName}
                  mimeType={doc?.mimeType}
                  className="size-8 shrink-0"
                />
                <Stack gap={1} className="min-w-0">
                  <Text
                    as="span"
                    className="text-foreground truncate text-base leading-tight font-semibold tracking-tight"
                  >
                    {displayName}
                  </Text>
                </Stack>
              </HStack>
              <ActionRow gap={2} className="shrink-0">
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
            </Row>
          </div>
        )
      }
    >
      {!isLoading && !resolvedUrl && open ? (
        <div className="grid flex-1 place-items-center p-6">
          <Text as="div" variant="error">
            {t('preview.failedToLoad')}
          </Text>
        </div>
      ) : (
        <div
          className={cn(
            '-mx-2 -mt-1 -mb-1 grid min-h-0 flex-1',
            documentId && 'grid-cols-[minmax(0,1fr)_260px]',
          )}
        >
          <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
            {resolvedUrl ? (
              <DocumentPreview
                url={resolvedUrl}
                fileName={displayName}
                mimeType={doc?.mimeType}
              />
            ) : (
              <PreviewPaneSkeleton />
            )}
          </div>
          {documentId && <DetailsSidebar doc={doc} loading={isLoading} />}
        </div>
      )}
    </Dialog>
  );
}
