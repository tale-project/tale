'use client';

import { FileText, Globe, ChevronDown, ChevronUp } from 'lucide-react';
import { memo, useState, useCallback } from 'react';

import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
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
  const chunkCount = source.chunkNumbers.length;

  const tooltipContent = (
    <div className="flex flex-col gap-0.5">
      <span className="font-medium">{title}</span>
      {chunkCount > 1 && (
        <span>{t('citations.chunkCount', { count: chunkCount })}</span>
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
          {chunkCount > 1 && (
            <div className="text-muted-foreground text-[10px]">
              {t('citations.chunkCount', { count: chunkCount })}
            </div>
          )}
        </div>
        <span className="text-muted-foreground shrink-0 text-[10px]">
          [{source.chunkNumbers.join(', ')}]
        </span>
      </button>
    </Tooltip>
  );
}

interface SourceDetailDialogProps {
  source: SourceGroup | null;
  onClose: () => void;
}

/**
 * Normalize chunk content for display:
 * - Convert literal `\n` sequences to real newlines
 * - Collapse 3+ consecutive blank lines into 2
 */
function normalizeContent(raw: string): string {
  return raw
    .replace(/\\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function SourceDetailDialog({ source, onClose }: SourceDetailDialogProps) {
  const { t } = useT('chat');
  if (!source) return null;

  const title =
    source.filename ??
    (source.url
      ? getDomain(source.url)
      : t('citations.source', { number: String(source.number) }));

  const chunkCount = source.chunks.length;

  return (
    <ViewDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      size="xl"
      className="overflow-x-hidden"
    >
      <div className="flex min-w-0 flex-col gap-4 overflow-hidden">
        {/* Metadata */}
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {source.relevance != null && (
            <span>
              {t('citations.relevance', {
                score: String(Math.round(source.relevance)),
              })}
            </span>
          )}
          {source.pages.length > 0 && (
            <span>
              {source.pages
                .map((p) => t('citations.page', { page: String(p) }))
                .join(', ')}
            </span>
          )}
          {chunkCount > 1 && (
            <span>{t('citations.chunkCount', { count: chunkCount })}</span>
          )}
        </div>

        {/* Chunk contents */}
        <div className="flex flex-col gap-3">
          {source.chunks.map((chunk) => (
            <div key={chunk.number} className="bg-background/50 rounded-lg p-3">
              {chunkCount > 1 && (
                <div className="text-muted-foreground mb-2 flex items-center gap-2 text-[11px]">
                  <span className="bg-muted rounded px-1.5 py-0.5 font-medium">
                    [{chunk.number}]
                  </span>
                  {chunk.page != null && (
                    <span>
                      {t('citations.page', { page: String(chunk.page) })}
                    </span>
                  )}
                  {chunk.relevance != null && (
                    <span>
                      {t('citations.relevance', {
                        score: String(Math.round(chunk.relevance)),
                      })}
                    </span>
                  )}
                </div>
              )}
              {chunk.content ? (
                <div
                  className="text-foreground/90 max-h-[300px] overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap"
                  style={{ overflowWrap: 'anywhere' }}
                >
                  {normalizeContent(chunk.content)}
                </div>
              ) : (
                <div className="text-muted-foreground text-sm italic">
                  {t('citations.noContent')}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </ViewDialog>
  );
}

interface SourceCardsProps {
  citations: Map<number, CitationInfo>;
}

function SourceCardsComponent({ citations }: SourceCardsProps) {
  const { t } = useT('chat');
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedSource, setSelectedSource] = useState<SourceGroup | null>(
    null,
  );

  const sourceList = getUniqueSources(citations);

  const handleCardClick = useCallback((source: SourceGroup) => {
    if (source.type === 'web' && source.url) {
      window.open(source.url, '_blank', 'noopener,noreferrer');
    } else {
      setSelectedSource(source);
    }
  }, []);

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

      <SourceDetailDialog
        source={selectedSource}
        onClose={() => setSelectedSource(null)}
      />
    </div>
  );
}

export const SourceCards = memo(SourceCardsComponent);
