'use client';

import { Download, X, Loader2 } from 'lucide-react';
import { useState, useMemo } from 'react';

import { DocumentIcon } from '@/app/components/ui/data-display/document-icon';
import { Dialog } from '@/app/components/ui/dialog/dialog';
import { ActionRow } from '@/app/components/ui/layout/action-row';
import { HStack } from '@/app/components/ui/layout/layout';
import { Separator } from '@/app/components/ui/layout/separator';
import { Button } from '@/app/components/ui/primitives/button';
import { IconButton } from '@/app/components/ui/primitives/icon-button';
import { Heading } from '@/app/components/ui/typography/heading';
import { Text } from '@/app/components/ui/typography/text';
import { useTeams } from '@/app/features/settings/teams/hooks/queries';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useLocale } from '@/app/hooks/use-locale';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { formatBytes } from '@/lib/utils/format/number';

import type { Document } from '../hooks/queries';

import { useDocuments } from '../hooks/queries';
import { DocumentPreview } from './document-preview';
import { RagStatusBadge } from './rag-status-badge';

interface DocumentPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  documentId?: string;
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

function DetailsSidebar({ doc }: { doc: Document }) {
  const { t } = useT('documents');
  const { formatDate } = useFormatDate();
  const { locale } = useLocale();
  const { teams } = useTeams();

  const teamNames = useMemo(() => {
    const ids = doc.teamIds ?? [];
    if (ids.length === 0 || !teams) return [];
    return ids
      .map(
        (id) =>
          teams.find((entry: { id: string; name: string }) => entry.id === id)
            ?.name,
      )
      .filter(Boolean);
  }, [doc.teamIds, teams]);

  const sourceLabel = useMemo(() => {
    const labels: Record<string, string> = {
      upload: t('preview.sidebar.sourceUpload'),
      onedrive: t('preview.sidebar.sourceOnedrive'),
      sharepoint: t('preview.sidebar.sourceSharepoint'),
    };
    return labels[doc.sourceProvider ?? 'upload'] ?? doc.sourceProvider;
  }, [doc.sourceProvider, t]);

  const modifiedDate = useMemo(() => {
    if (!doc.lastModified) return undefined;
    return formatDate(new Date(doc.lastModified), 'short');
  }, [doc.lastModified, formatDate]);

  return (
    <aside
      className="flex w-[220px] shrink-0 flex-col gap-3 overflow-y-auto"
      aria-label={t('preview.sidebar.document')}
    >
      <SidebarRow label={t('preview.sidebar.document')}>
        <HStack gap={2} className="items-center">
          <DocumentIcon fileName={doc.name ?? ''} className="w-4" />
          <span className="truncate">{doc.name}</span>
        </HStack>
      </SidebarRow>

      {doc.size != null && (
        <SidebarRow label={t('preview.sidebar.size')}>
          {formatBytes(doc.size, locale)}
        </SidebarRow>
      )}

      <SidebarRow label={t('preview.sidebar.source')}>{sourceLabel}</SidebarRow>

      <Separator />

      <SidebarRow label={t('preview.sidebar.ragStatus')}>
        <RagStatusBadge
          status={doc.ragStatus}
          indexedAt={doc.ragIndexedAt}
          error={doc.ragError}
          documentId={doc.id}
        />
      </SidebarRow>

      <Separator />

      {teamNames.length > 0 && (
        <SidebarRow label={t('preview.sidebar.teams')}>
          {teamNames.join(', ')}
        </SidebarRow>
      )}

      {doc.createdByName && (
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
  );
}

export function DocumentPreviewDialog({
  open,
  onOpenChange,
  organizationId,
  documentId,
  fileName,
}: DocumentPreviewDialogProps) {
  const { t } = useT('documents');
  const [isDownloading, setIsDownloading] = useState(false);
  const { toast } = useToast();

  const { documents, isLoading } = useDocuments(organizationId);

  const doc = useMemo(() => {
    if (!documents || !open || !documentId) return undefined;
    return documents.find((d) => d.id === documentId);
  }, [documents, open, documentId]);

  const displayName = fileName || doc?.name || t('preview.document');

  const handleDownload = async () => {
    if (!doc?.url) return;

    try {
      setIsDownloading(true);

      const response = await fetch(doc.url);
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
            {doc?.url && (
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
      {isLoading && (
        <div className="grid flex-1 place-items-center p-6">
          <Text as="div" variant="muted">
            {t('preview.loading')}
          </Text>
        </div>
      )}
      {!isLoading && !doc && open && (
        <div className="grid flex-1 place-items-center p-6">
          <Text as="div" variant="error">
            {t('preview.failedToLoad')}
          </Text>
        </div>
      )}
      {!isLoading && doc?.url && (
        <div className="flex min-h-0 flex-1 gap-5 px-5 pb-5">
          <div className="flex min-w-0 flex-1 flex-col">
            <DocumentPreview url={doc.url} fileName={displayName} />
          </div>
          <DetailsSidebar doc={doc} />
        </div>
      )}
    </Dialog>
  );
}
