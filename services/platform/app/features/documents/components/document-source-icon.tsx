'use client';

import { cn } from '@tale/ui/cn';
import { Tooltip } from '@tale/ui/tooltip';
import { RefreshCw, RefreshCwOff, TriangleAlert, Unplug } from 'lucide-react';

import type { DocumentItem } from '@/types/documents';

import type { DocumentSource } from '../hooks/use-document-source';
import { useDocumentSource } from '../hooks/use-document-source';
import { SyncHealthButton } from './sync-health-button';

/** What the small glyph beside the vendor mark says about the sync. */
type SyncState = 'synced' | 'notSynced' | 'failed' | 'needsReauth';

const SYNC_GLYPH: Record<
  SyncState,
  { Icon: typeof RefreshCw; className: string }
> = {
  synced: { Icon: RefreshCw, className: 'text-muted-foreground' },
  notSynced: { Icon: RefreshCwOff, className: 'text-muted-foreground' },
  failed: { Icon: TriangleAlert, className: 'text-destructive' },
  // A dead grant is a pulled plug: only reconnecting the account resumes it.
  needsReauth: { Icon: Unplug, className: 'text-destructive' },
};

/** What the source itself says, before a broken sync overrides it. */
function sourceState(source: DocumentSource): SyncState | undefined {
  if (source.synced === undefined) return undefined;
  return source.synced ? 'synced' : 'notSynced';
}

/**
 * The vendor mark and its sync glyph, without a name of their own — the
 * caller supplies the accessible name (the Source cell) or the words beside
 * it (the preview sidebar).
 */
export function DocumentSourceMark({
  source,
  /** Overrides the source's own state — a broken sync, in the Source cell. */
  state,
}: {
  source: DocumentSource;
  state?: SyncState;
}) {
  const { Icon } = source;
  const resolved = state ?? sourceState(source);
  const glyph = resolved === undefined ? undefined : SYNC_GLYPH[resolved];
  return (
    <>
      <Icon
        className={cn(
          'size-5 shrink-0',
          !source.brand && 'text-muted-foreground',
        )}
      />
      {glyph && (
        <glyph.Icon
          aria-hidden
          className={cn('size-3.5 shrink-0', glyph.className)}
        />
      )}
    </>
  );
}

interface DocumentSourceIconProps {
  sourceProvider: DocumentItem['sourceProvider'];
  sourceMode: DocumentItem['sourceMode'];
  /** Set on a synced row; a failed sync replaces the sync glyph. */
  syncHealth?: DocumentItem['syncHealth'];
  /** The synced item's name, for the failure dialog's sentences. */
  itemName?: string;
}

/**
 * Where a document came from, as the Source cell shows it: the vendor's mark,
 * trailed by a smaller glyph saying whether Tale keeps it in sync, imported it
 * once, or cannot reach the source any more. Icons rather than words, because
 * a label such as "OneDrive (synchronisiert)" cannot fit the column in every
 * locale; the words stay on hover and as the accessible name. A broken sync is
 * a button that opens the reason and the way back. Renders nothing for a row
 * with no provenance at all.
 */
export function DocumentSourceIcon({
  sourceProvider,
  sourceMode,
  syncHealth,
  itemName,
}: DocumentSourceIconProps) {
  const source = useDocumentSource(sourceProvider, sourceMode);
  if (!source) return null;

  const failure: SyncState | undefined =
    syncHealth?.status === 'failed'
      ? syncHealth.needsReauth
        ? 'needsReauth'
        : 'failed'
      : undefined;
  const mark = <DocumentSourceMark source={source} state={failure} />;

  // A sync that stopped working outranks the source label: the mark says so
  // in the failure colour and opens the reason + the way back.
  if (syncHealth?.status === 'failed') {
    return (
      <SyncHealthButton health={syncHealth} itemName={itemName ?? ''}>
        {mark}
      </SyncHealthButton>
    );
  }

  return (
    <Tooltip content={source.label}>
      <span
        role="img"
        aria-label={source.label}
        className="inline-flex items-center gap-1 align-middle"
      >
        {mark}
      </span>
    </Tooltip>
  );
}
