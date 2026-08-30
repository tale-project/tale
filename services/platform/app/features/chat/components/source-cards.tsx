'use client';

/**
 * Source cards — the 0.3 chat page's "what this answer read", restored.
 *
 * Sources are derived from the turn's TOOL RESULTS, never from the model's
 * prose: every page or document the assistant actually LOADED (`web_fetch`,
 * `rag_fetch`) becomes one card under the answer. A `rag_search` hit that
 * was never fetched is a candidate, not a source, so it stays in the
 * timeline only — the cards never claim more reading than happened.
 *
 * Web sources link out (new tab, `rel` hardened); document sources open
 * in-app — the fetched file id drives the document preview, and a media
 * citation with a completed transcript opens the transcript instead (the
 * storage id points at audio/video bytes a file preview cannot render).
 * Beyond the first three, cards fold behind a "Show all N sources" toggle.
 */

import { Text } from '@tale/ui/text';
import { ChevronDown, ChevronUp, FileText, Globe } from 'lucide-react';
import { useState } from 'react';

import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { DocumentPreviewDialog } from '@/app/features/documents/components/document-preview-dialog';
import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-utils';

import { useChatQuery } from '../data/chat-backend';
import type { MessagePart } from '../types';
import { hostnameOf } from '../utils/activity-label';

/** Cards beyond this fold behind the "Show all N sources" toggle. */
const COLLAPSED_LIMIT = 3;

export interface SourceRef {
  readonly kind: 'web' | 'document';
  readonly label: string;
  /** Absent on document sources — a file id does not navigate. */
  readonly url?: string;
  /** The hostname, as the card's muted detail (web only). */
  readonly domain?: string;
  /** The fetched file's storage id — drives the in-app preview (document
   * only). */
  readonly fileId?: string;
}

/** One tool result → its source, when the call actually loaded content. */
function sourceOfResult(tool: string, output: unknown): SourceRef | null {
  if (!isRecord(output) || output.status !== 'ok') return null;

  if (tool === 'web_fetch' || output.kind === 'web-page') {
    const url = typeof output.url === 'string' ? output.url : undefined;
    if (url === undefined) return null;
    const title =
      typeof output.title === 'string' && output.title.length > 0
        ? output.title
        : url;
    const domain = hostnameOf(url);
    return {
      kind: 'web',
      label: title,
      url,
      ...(domain !== undefined ? { domain } : {}),
    };
  }

  if (tool === 'rag_fetch' && output.kind === 'document') {
    const ref = typeof output.ref === 'string' ? output.ref : undefined;
    const filename =
      typeof output.filename === 'string' && output.filename.length > 0
        ? output.filename
        : ref;
    if (filename === undefined) return null;
    return {
      kind: 'document',
      label: filename,
      ...(ref !== undefined ? { fileId: ref } : {}),
    };
  }

  return null;
}

/**
 * The sources a message's parts actually read, in call order, deduplicated
 * by target (a page fetched twice is one source).
 */
export function extractSources(parts: readonly MessagePart[]): SourceRef[] {
  const sources: SourceRef[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    if (part.type !== 'tool-result') continue;
    const source = sourceOfResult(part.capabilityId, part.output);
    if (source === null) continue;
    const key = source.url ?? `document:${source.fileId ?? source.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push(source);
  }
  return sources;
}

export function SourceCards({
  parts,
  organizationId,
}: {
  parts: readonly MessagePart[];
  /** Enables the in-app document/transcript preview. Absent on surfaces
   * without an org context (a shared snapshot) — document chips stay inert
   * there. */
  organizationId?: string;
}) {
  const { t } = useT('chat');
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedSource, setSelectedSource] = useState<SourceRef | null>(null);
  const [transcriptPreview, setTranscriptPreview] = useState<{
    fileName: string;
    transcript: string;
    durationSec?: number;
  } | null>(null);

  const sources = extractSources(parts);

  // Batch-load metadata for the fetched documents so a media citation routes
  // to the transcript preview rather than the generic document preview
  // (which would try to render mp3 bytes as a file).
  const documentFileIds = [
    ...new Set(
      sources.flatMap((source) =>
        source.kind === 'document' && source.fileId !== undefined
          ? [source.fileId]
          : [],
      ),
    ),
  ];
  const fileMetas = useChatQuery(
    'file_metadata/queries:getByStorageIds',
    organizationId !== undefined && documentFileIds.length > 0
      ? { organizationId, storageIds: documentFileIds }
      : 'skip',
  );
  const metaByFileId = new Map(
    (fileMetas.status === 'ready' ? fileMetas.data : []).map((meta) => [
      meta.storageId,
      meta,
    ]),
  );

  if (sources.length === 0) return null;

  const openDocument = (source: SourceRef) => {
    if (source.fileId !== undefined) {
      const meta = metaByFileId.get(source.fileId);
      const contentType = meta?.contentType;
      if (
        (contentType?.startsWith('audio/') === true ||
          contentType?.startsWith('video/') === true) &&
        meta?.transcriptionStatus === 'completed' &&
        meta.transcript !== undefined
      ) {
        setTranscriptPreview({
          fileName: meta.fileName || source.label,
          transcript: meta.transcript,
          ...(meta.transcriptionDurationSec !== undefined
            ? { durationSec: meta.transcriptionDurationSec }
            : {}),
        });
        return;
      }
    }
    setSelectedSource(source);
  };

  const needsCollapse = sources.length > COLLAPSED_LIMIT;
  const visibleSources =
    needsCollapse && !isExpanded ? sources.slice(0, COLLAPSED_LIMIT) : sources;

  const cardClass =
    'border-border bg-muted/40 flex max-w-72 items-center gap-1.5 rounded-full border px-2.5 py-1';
  const card = (source: SourceRef) => (
    <>
      {source.kind === 'web' ? (
        <Globe
          aria-hidden
          className="text-muted-foreground size-3.5 shrink-0"
        />
      ) : (
        <FileText
          aria-hidden
          className="text-muted-foreground size-3.5 shrink-0"
        />
      )}
      <span className="text-foreground min-w-0 truncate text-xs">
        {source.label}
      </span>
      {source.domain !== undefined && (
        <span className="text-muted-foreground shrink-0 text-xs">
          {source.domain}
        </span>
      )}
    </>
  );

  return (
    // Gentle fade-in when the block mounts at stream end (opacity-only, no
    // layout shift; self-neutralizes under prefers-reduced-motion).
    <div className="animate-content-in mt-2 min-w-0">
      <p className="text-muted-foreground mb-1.5 text-xs font-medium">
        {t('sources.label')}
      </p>
      <ul className="flex min-w-0 flex-wrap gap-1.5" role="list">
        {visibleSources.map((source) => (
          <li key={source.url ?? source.fileId ?? source.label}>
            {source.url !== undefined ? (
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`${cardClass} hover:bg-muted focus-visible:ring-ring transition-colors focus-visible:ring-2 focus-visible:outline-none`}
              >
                {card(source)}
              </a>
            ) : source.kind === 'document' && organizationId !== undefined ? (
              <button
                type="button"
                onClick={() => openDocument(source)}
                className={`${cardClass} hover:bg-muted focus-visible:ring-ring text-left transition-colors focus-visible:ring-2 focus-visible:outline-none`}
              >
                {card(source)}
              </button>
            ) : (
              <span className={cardClass}>{card(source)}</span>
            )}
          </li>
        ))}
      </ul>
      {needsCollapse && (
        <button
          type="button"
          onClick={() => setIsExpanded((value) => !value)}
          className="text-muted-foreground hover:text-foreground mt-1 flex items-center gap-0.5 text-xs transition-colors"
        >
          {isExpanded ? (
            <>
              <ChevronUp aria-hidden className="size-3" />
              {t('sources.hide')}
            </>
          ) : (
            <>
              <ChevronDown aria-hidden className="size-3" />
              {t('sources.showAll', { count: sources.length })}
            </>
          )}
        </button>
      )}

      {selectedSource !== null && organizationId !== undefined && (
        <DocumentPreviewDialog
          open
          onOpenChange={(open) => {
            if (!open) setSelectedSource(null);
          }}
          {...(selectedSource.fileId !== undefined
            ? { fileId: selectedSource.fileId }
            : {})}
          fileName={selectedSource.label}
        />
      )}

      {transcriptPreview !== null && (
        <ViewDialog
          open
          onOpenChange={(open) => {
            if (!open) setTranscriptPreview(null);
          }}
          title={transcriptPreview.fileName}
          {...(transcriptPreview.durationSec !== undefined
            ? {
                description: t('transcription.previewSubtitle', {
                  seconds: Math.round(transcriptPreview.durationSec),
                }),
              }
            : {})}
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
