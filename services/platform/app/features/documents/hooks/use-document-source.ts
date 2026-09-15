'use client';

import { GoogleDriveIcon } from '@tale/ui/icons/google-drive-icon';
import { OneDriveIcon } from '@tale/ui/icons/onedrive-icon';
import { SharePointIcon } from '@tale/ui/icons/sharepoint-icon';
import { BookOpen, Bot, Code, Plug, Upload } from 'lucide-react';
import type { ComponentType } from 'react';

import { useT } from '@/lib/i18n/client';
import type { DocumentItem } from '@/types/documents';

type DocumentsT = ReturnType<typeof useT>['t'];

export interface DocumentSource {
  /** The whole fact in words: the tooltip, the accessible name, the label. */
  label: string;
  Icon: ComponentType<{ className?: string }>;
  /** A vendor mark keeps its own colours; a generic glyph is muted. */
  brand: boolean;
  /** Whether Tale keeps the file in sync; absent where no sync applies. */
  synced?: boolean;
}

function vendor(
  Icon: DocumentSource['Icon'],
  synced: boolean,
  label: string,
): DocumentSource {
  return { label, Icon, brand: true, synced };
}

function glyph(Icon: DocumentSource['Icon'], label: string): DocumentSource {
  return { label, Icon, brand: false };
}

function getDocumentSource(
  sourceProvider: DocumentItem['sourceProvider'],
  sourceMode: DocumentItem['sourceMode'],
  t: DocumentsT,
): DocumentSource | null {
  const synced = sourceMode === 'auto';
  switch (sourceProvider) {
    case undefined:
    case '':
      return null;
    case 'onedrive':
      return vendor(
        OneDriveIcon,
        synced,
        synced
          ? t('sourceType.oneDriveSynced')
          : t('sourceType.oneDriveNotSynced'),
      );
    case 'sharepoint':
      return vendor(
        SharePointIcon,
        synced,
        synced
          ? t('sourceType.sharePointSynced')
          : t('sourceType.sharePointNotSynced'),
      );
    // `gdrive` is the engine's older name, still honoured by the WebDAV layer.
    case 'google_drive':
    case 'gdrive':
      return vendor(
        GoogleDriveIcon,
        synced,
        synced
          ? t('sourceType.googleDriveSynced')
          : t('sourceType.googleDriveNotSynced'),
      );
    case 'upload':
      return glyph(Upload, t('sourceType.uploaded'));
    case 'agent':
      return glyph(Bot, t('sourceType.agent'));
    case 'knowledge':
      return glyph(BookOpen, t('sourceType.knowledgeEntry'));
    case 'api_import':
      return glyph(Code, t('sourceType.api'));
    // No bundled mark for these; the plug is the connectors catalog's own
    // fallback.
    case 'webdav':
      return glyph(Plug, t('sourceType.webDav'));
    case 'confluence':
      return glyph(Plug, t('sourceType.confluence'));
    // A provenance a REST caller named itself: its own words are the label.
    default:
      return glyph(Plug, sourceProvider);
  }
}

/**
 * Where a document came from, as every documents surface names it. One map,
 * so the table's icons and the preview's label cannot drift apart again (the
 * preview once knew three providers and printed `google_drive` for the rest).
 */
export function useDocumentSource(
  sourceProvider: DocumentItem['sourceProvider'],
  sourceMode: DocumentItem['sourceMode'],
): DocumentSource | null {
  const { t } = useT('documents');
  return getDocumentSource(sourceProvider, sourceMode, t);
}
