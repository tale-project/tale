'use client';

import { cn } from '@tale/ui/cn';
import { GoogleDriveIcon } from '@tale/ui/icons/google-drive-icon';
import { OneDriveIcon } from '@tale/ui/icons/onedrive-icon';
import { SharePointIcon } from '@tale/ui/icons/sharepoint-icon';
import { Tooltip } from '@tale/ui/tooltip';
import { Plug, RefreshCw, RefreshCwOff, Upload } from 'lucide-react';
import type { ComponentType } from 'react';

import { useT } from '@/lib/i18n/client';
import type { DocumentItem } from '@/types/documents';

type DocumentsT = ReturnType<typeof useT>['t'];

interface DocumentSource {
  /** The whole fact in words — the tooltip and the accessible name. */
  label: string;
  Icon: ComponentType<{ className?: string }>;
  /** A vendor mark keeps its own colours; a generic glyph is muted. */
  brand: boolean;
  /** Absent where the source has no sync to speak of (an upload, WebDAV). */
  synced?: boolean;
}

function getDocumentSource(
  sourceProvider: DocumentItem['sourceProvider'],
  sourceMode: DocumentItem['sourceMode'],
  t: DocumentsT,
): DocumentSource | null {
  const synced = sourceMode === 'auto';
  switch (sourceProvider) {
    case 'onedrive':
      return {
        label: synced
          ? t('sourceType.oneDriveSynced')
          : t('sourceType.oneDriveNotSynced'),
        Icon: OneDriveIcon,
        brand: true,
        synced,
      };
    case 'sharepoint':
      return {
        label: synced
          ? t('sourceType.sharePointSynced')
          : t('sourceType.sharePointNotSynced'),
        Icon: SharePointIcon,
        brand: true,
        synced,
      };
    case 'google_drive':
      return {
        label: synced
          ? t('sourceType.googleDriveSynced')
          : t('sourceType.googleDriveNotSynced'),
        Icon: GoogleDriveIcon,
        brand: true,
        synced,
      };
    case 'upload':
      return { label: t('sourceType.uploaded'), Icon: Upload, brand: false };
    // No bundled mark for either; the plug is the connectors catalog's own
    // fallback.
    case 'webdav':
      return { label: t('sourceType.webDav'), Icon: Plug, brand: false };
    case 'confluence':
      return { label: t('sourceType.confluence'), Icon: Plug, brand: false };
    default:
      return null;
  }
}

interface DocumentSourceIconProps {
  sourceProvider: DocumentItem['sourceProvider'];
  sourceMode: DocumentItem['sourceMode'];
}

/**
 * Where a document came from, as the Source cell shows it: the vendor's mark,
 * trailed by a smaller glyph saying whether Tale keeps it in sync or imported
 * it once. Icons rather than words, because a label such as
 * "OneDrive (synchronisiert)" cannot fit the column in every locale; the
 * words stay on hover and as the accessible name. Renders nothing for a
 * provenance with no mark (an agent's file, an API import).
 */
export function DocumentSourceIcon({
  sourceProvider,
  sourceMode,
}: DocumentSourceIconProps) {
  const { t } = useT('documents');
  const source = getDocumentSource(sourceProvider, sourceMode, t);
  if (!source) return null;

  const { Icon } = source;
  const SyncIcon =
    source.synced === undefined
      ? undefined
      : source.synced
        ? RefreshCw
        : RefreshCwOff;

  return (
    <Tooltip content={source.label}>
      <span
        role="img"
        aria-label={source.label}
        className="inline-flex items-center gap-1 align-middle"
      >
        <Icon
          className={cn(
            'size-5 shrink-0',
            !source.brand && 'text-muted-foreground',
          )}
        />
        {SyncIcon && (
          <SyncIcon
            aria-hidden
            className="text-muted-foreground size-3.5 shrink-0"
          />
        )}
      </span>
    </Tooltip>
  );
}
