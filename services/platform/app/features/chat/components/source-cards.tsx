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
 * Web sources link out (new tab, `rel` hardened); document sources are
 * plain chips — a file id is not a navigable URL, and a wrong link is worse
 * than none.
 */

import { FileText, Globe } from 'lucide-react';

import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-utils';

import type { MessagePart } from '../types';

export interface SourceRef {
  readonly kind: 'web' | 'document';
  readonly label: string;
  /** Absent on document sources — a file id does not navigate. */
  readonly url?: string;
  /** The hostname, as the card's muted detail (web only). */
  readonly domain?: string;
}

/** The hostname of a URL, when it parses — shared with the timeline's
 * "Reading {hostname}" step titles. */
export function hostnameOf(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
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
    const filename =
      typeof output.filename === 'string' && output.filename.length > 0
        ? output.filename
        : typeof output.ref === 'string'
          ? output.ref
          : undefined;
    if (filename === undefined) return null;
    return { kind: 'document', label: filename };
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
    const key = source.url ?? `document:${source.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push(source);
  }
  return sources;
}

export function SourceCards({ parts }: { parts: readonly MessagePart[] }) {
  const { t } = useT('chat');
  const sources = extractSources(parts);
  if (sources.length === 0) return null;

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
    <div className="mt-2 min-w-0">
      <p className="text-muted-foreground mb-1.5 text-xs font-medium">
        {t('sources.label')}
      </p>
      <ul className="flex min-w-0 flex-wrap gap-1.5" role="list">
        {sources.map((source) => (
          <li key={source.url ?? source.label} className="min-w-0">
            {source.url !== undefined ? (
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="border-border bg-muted/40 hover:bg-muted focus-visible:ring-ring flex max-w-72 items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                {card(source)}
              </a>
            ) : (
              <span className="border-border bg-muted/40 flex max-w-72 items-center gap-1.5 rounded-full border px-2.5 py-1">
                {card(source)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
