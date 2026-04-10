'use client';

import { FileText, Globe, ChevronDown, ChevronUp } from 'lucide-react';
import { memo, useState, useMemo, useCallback } from 'react';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { DocumentPreviewDialog } from '../../documents/components/document-preview-dialog';
import type { CitationInfo } from '../hooks/use-citations';
import { getUniqueCitations } from '../hooks/use-citations';

const COLLAPSED_LIMIT = 3;

function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

interface SourceCardProps {
  citation: CitationInfo;
  onClick: () => void;
}

function SourceCard({ citation, onClick }: SourceCardProps) {
  const isWeb = citation.type === 'web';
  const Icon = isWeb ? Globe : FileText;
  const title =
    citation.filename ??
    (citation.url ? getDomain(citation.url) : `Source ${citation.number}`);
  const subtitle = isWeb
    ? citation.url
      ? getDomain(citation.url)
      : undefined
    : citation.page != null
      ? `p. ${citation.page}`
      : undefined;

  return (
    <button
      type="button"
      onClick={onClick}
      className="border-border bg-muted/50 hover:bg-muted flex max-w-[200px] min-w-0 shrink-0 items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors"
    >
      <Icon className="text-muted-foreground size-3.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium">{title}</div>
        {subtitle && (
          <div className="text-muted-foreground truncate text-[10px]">
            {subtitle}
          </div>
        )}
      </div>
      <span className="text-muted-foreground shrink-0 text-[10px]">
        [{citation.number}]
      </span>
    </button>
  );
}

interface SourceCardsProps {
  citations: Map<number, CitationInfo>;
}

function SourceCardsComponent({ citations }: SourceCardsProps) {
  const { t } = useT('chat');
  const organizationId = useOrganizationId();
  const [isExpanded, setIsExpanded] = useState(false);
  const [previewDocId, setPreviewDocId] = useState<string | undefined>();
  const [previewFileName, setPreviewFileName] = useState<string | undefined>();

  const citationList = getUniqueCitations(citations);

  // Collect all RAG fileIds to batch-query file metadata
  const ragFileIds = useMemo(() => {
    const ids: Id<'_storage'>[] = [];
    for (const c of citationList) {
      if (c.type === 'rag' && c.fileId) {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- fileId from RAG metadata is a Convex storage ID string
        ids.push(c.fileId as Id<'_storage'>);
      }
    }
    return ids;
  }, [citationList]);

  const { data: fileMetadataList } = useConvexQuery(
    api.file_metadata.queries.getByStorageIds,
    ragFileIds.length > 0 ? { storageIds: ragFileIds } : 'skip',
  );

  // Map storageId → documentId for quick lookup
  const storageToDocId = useMemo(() => {
    const map = new Map<string, string>();
    if (fileMetadataList) {
      for (const meta of fileMetadataList) {
        if (meta.documentId) {
          map.set(meta.storageId, meta.documentId);
        }
      }
    }
    return map;
  }, [fileMetadataList]);

  const handleCardClick = useCallback(
    (citation: CitationInfo) => {
      if (citation.type === 'web' && citation.url) {
        window.open(citation.url, '_blank', 'noopener,noreferrer');
      } else if (citation.type === 'rag' && citation.fileId) {
        const docId = storageToDocId.get(citation.fileId);
        if (docId) {
          setPreviewDocId(docId);
          setPreviewFileName(citation.filename);
        }
      }
    },
    [storageToDocId],
  );

  if (citationList.length === 0) return null;

  const needsCollapse = citationList.length > COLLAPSED_LIMIT;
  const visibleCitations =
    needsCollapse && !isExpanded
      ? citationList.slice(0, COLLAPSED_LIMIT)
      : citationList;

  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap gap-1.5 pb-1">
        {visibleCitations.map((citation) => (
          <SourceCard
            key={citation.number}
            citation={citation}
            onClick={() => handleCardClick(citation)}
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
                count: String(citationList.length),
              })}
            </>
          )}
        </button>
      )}

      {organizationId && (
        <DocumentPreviewDialog
          open={!!previewDocId}
          onOpenChange={(open) => {
            if (!open) setPreviewDocId(undefined);
          }}
          organizationId={organizationId}
          documentId={previewDocId}
          fileName={previewFileName}
        />
      )}
    </div>
  );
}

export const SourceCards = memo(SourceCardsComponent);
