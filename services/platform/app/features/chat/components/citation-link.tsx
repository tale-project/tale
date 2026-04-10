'use client';

import { memo } from 'react';

import { Popover } from '@/app/components/ui/overlays/popover';
import { useT } from '@/lib/i18n/client';

import type { CitationInfo } from '../hooks/use-citations';

interface CitationLinkProps {
  citation: CitationInfo;
  onNavigate?: (fileId: string, page?: number) => void;
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function CitationLinkComponent({ citation, onNavigate }: CitationLinkProps) {
  const { t } = useT('chat');

  const handleClick = () => {
    if (citation.type === 'web' && citation.url) {
      window.open(citation.url, '_blank', 'noopener,noreferrer');
    } else if (citation.fileId && onNavigate) {
      onNavigate(citation.fileId, citation.page);
    }
  };

  return (
    <Popover
      trigger={
        <button
          type="button"
          className="bg-primary/10 text-primary hover:bg-primary/20 inline-flex cursor-pointer items-center rounded px-1 py-0.5 text-xs font-medium transition-colors"
          onClick={handleClick}
          aria-label={t('citations.source', {
            number: String(citation.number),
          })}
        >
          [{citation.number}]
        </button>
      }
      side="top"
      align="center"
      contentClassName="w-64 p-3 text-sm"
    >
      <div className="space-y-1.5">
        {citation.filename && (
          <div className="font-medium">{citation.filename}</div>
        )}
        {citation.type === 'web' && citation.url && (
          <div className="text-muted-foreground truncate text-xs">
            {getDomain(citation.url)}
          </div>
        )}
        {citation.type === 'rag' && citation.page != null && (
          <div className="text-muted-foreground">
            {t('citations.page', { page: String(citation.page) })}
          </div>
        )}
        {citation.relevance != null && (
          <div className="text-muted-foreground">
            {t('citations.relevance', {
              score: citation.relevance.toFixed(1),
            })}
          </div>
        )}
        {citation.type === 'web' && citation.url && (
          <a
            href={citation.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            {t('citations.visitPage')}
          </a>
        )}
        {citation.type === 'rag' && citation.fileId && onNavigate && (
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={handleClick}
          >
            {t('citations.viewDocument')}
          </button>
        )}
      </div>
    </Popover>
  );
}

export const CitationLink = memo(CitationLinkComponent);
