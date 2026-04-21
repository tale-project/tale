'use client';

import { useQuery } from 'convex/react';
import { FileText, Globe, ChevronDown, ChevronUp } from 'lucide-react';
import { memo, useState, useCallback, useMemo } from 'react';

import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { Text } from '@/app/components/ui/typography/text';
import { DocumentPreviewDialog } from '@/app/features/documents/components/document-preview-dialog';
import { api } from '@/convex/_generated/api';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';

import type { CitationInfo } from '../hooks/use-citations';
import type { SourceGroup } from '../hooks/use-citations';
import { getUniqueSources } from '../hooks/use-citations';

const COLLAPSED_LIMIT = 3;

function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

interface SourceCardProps {
  source: SourceGroup;
  onClick: () => void;
}

function SourceCard({ source, onClick }: SourceCardProps) {
  const { t } = useT('chat');
  const isWeb = source.type === 'web';
  const Icon = isWeb ? Globe : FileText;
  const title =
    source.filename ??
    (source.url
      ? getDomain(source.url)
      : t('citations.source', { number: String(source.number) }));

  const tooltipContent = (
    <div className="flex flex-col gap-0.5">
      <span className="font-medium">{title}</span>
      {source.chunkCount > 1 && (
        <span>{t('citations.chunkCount', { count: source.chunkCount })}</span>
      )}
      {source.relevance != null && (
        <span>
          {t('citations.relevance', {
            score: String(Math.round(source.relevance)),
          })}
        </span>
      )}
    </div>
  );

  return (
    <Tooltip content={tooltipContent} side="top">
      <button
        type="button"
        onClick={onClick}
        className="border-border bg-muted/50 hover:bg-muted flex max-w-[240px] min-w-0 shrink-0 items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors"
      >
        <Icon className="text-muted-foreground size-3.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium">{title}</div>
          {source.chunkCount > 1 && (
            <div className="text-muted-foreground text-[10px]">
              {t('citations.chunkCount', { count: source.chunkCount })}
            </div>
          )}
        </div>
      </button>
    </Tooltip>
  );
}

interface SourceCardsProps {
  citations: Map<number, CitationInfo>;
  organizationId?: string;
}

function SourceCardsComponent({ citations, organizationId }: SourceCardsProps) {
  const { t } = useT('chat');
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedSource, setSelectedSource] = useState<SourceGroup | null>(
    null,
  );
  const [transcriptPreview, setTranscriptPreview] = useState<{
    fileName: string;
    transcript: string;
    durationSec?: number;
  } | null>(null);

  const sourceList = getUniqueSources(citations);

  // Batch-load metadata for RAG sources so we can detect audio citations and
  // route their clicks to the transcript preview rather than the generic
  // DocumentPreviewDialog (which would try to render mp3 bytes as a file).
  const uniqueRagFileIds = useMemo(() => {
    const ids: string[] = [];
    for (const s of sourceList) {
      if (s.type === 'rag' && s.fileId) ids.push(s.fileId);
    }
    return [...new Set(ids)].map((id) => toId<'_storage'>(id));
  }, [sourceList]);
  const fileMetas = useQuery(
    api.file_metadata.queries.getByStorageIds,
    uniqueRagFileIds.length > 0 ? { storageIds: uniqueRagFileIds } : 'skip',
  );
  const metaByFileId = useMemo(() => {
    const map = new Map<
      string,
      {
        fileName: string;
        contentType: string;
        transcript?: string;
        transcriptionStatus?: string;
        transcriptionDurationSec?: number;
      }
    >();
    if (!fileMetas) return map;
    for (const m of fileMetas) {
      map.set(m.storageId, m);
    }
    return map;
  }, [fileMetas]);

  const handleCardClick = useCallback(
    (source: SourceGroup) => {
      if (source.type === 'web' && source.url) {
        window.open(source.url, '_blank', 'noopener,noreferrer');
        return;
      }
      // Audio citations: transcript lives in fileMetadata.transcript; the
      // storageId points at the mp3 bytes, not a text file. Route to the
      // transcript dialog instead of DocumentPreviewDialog.
      if (source.fileId) {
        const meta = metaByFileId.get(source.fileId);
        if (
          meta?.contentType?.startsWith('audio/') &&
          meta.transcriptionStatus === 'completed' &&
          meta.transcript
        ) {
          setTranscriptPreview({
            fileName: meta.fileName || source.filename || 'Audio',
            transcript: meta.transcript,
            durationSec: meta.transcriptionDurationSec,
          });
          return;
        }
      }
      setSelectedSource(source);
    },
    [metaByFileId],
  );

  if (sourceList.length === 0) return null;

  const needsCollapse = sourceList.length > COLLAPSED_LIMIT;
  const visibleSources =
    needsCollapse && !isExpanded
      ? sourceList.slice(0, COLLAPSED_LIMIT)
      : sourceList;

  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap gap-1.5 pb-1">
        {visibleSources.map((source) => (
          <SourceCard
            key={source.number}
            source={source}
            onClick={() => handleCardClick(source)}
          />
        ))}
      </div>
      {needsCollapse && (
        <button
          type="button"
          onClick={() => setIsExpanded((v) => !v)}
          className="text-muted-foreground hover:text-foreground mt-1 flex items-center gap-0.5 text-xs transition-colors"
        >
          {isExpanded ? (
            <>
              <ChevronUp className="size-3" />
              {t('citations.hideSources')}
            </>
          ) : (
            <>
              <ChevronDown className="size-3" />
              {t('citations.showAllSources', {
                count: String(sourceList.length),
              })}
            </>
          )}
        </button>
      )}

      {selectedSource && organizationId && (
        <DocumentPreviewDialog
          open
          onOpenChange={(open) => {
            if (!open) setSelectedSource(null);
          }}
          organizationId={organizationId}
          fileId={selectedSource.fileId}
          fileName={selectedSource.filename}
        />
      )}

      {transcriptPreview && (
        <ViewDialog
          open
          onOpenChange={(open) => {
            if (!open) setTranscriptPreview(null);
          }}
          title={transcriptPreview.fileName}
          description={
            transcriptPreview.durationSec
              ? t('transcription.previewSubtitle', {
                  seconds: Math.round(transcriptPreview.durationSec),
                })
              : undefined
          }
          size="lg"
        >
          <Text
            as="div"
            variant="body"
            className="max-h-[60vh] overflow-y-auto leading-relaxed whitespace-pre-wrap"
          >
            {transcriptPreview.transcript}
          </Text>
        </ViewDialog>
      )}
    </div>
  );
}

export const SourceCards = memo(SourceCardsComponent);
