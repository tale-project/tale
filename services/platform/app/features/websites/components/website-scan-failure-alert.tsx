'use client';

import { Alert } from '@tale/ui/alert';
import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';

import { useT } from '@/lib/i18n/client';

import {
  embeddingFailureClass,
  embeddingHintKey,
  type ScanErrorKind,
  scanEmptyMessageKey,
  scanErrorDetail,
  scanErrorMessageKey,
} from '../lib/scan-error';

interface WebsiteScanFailureAlertProps {
  kind: ScanErrorKind;
  /** The stored reason (`metadata.lastSyncError`); null when the row has none. */
  reason: string | null;
  /** A whole site or a URL list: the missing-registration reasons differ. */
  sourceKind?: 'site' | 'list';
  /** The scan stored nothing — said ahead of the reason. */
  empty?: boolean;
}

/**
 * A failed scan as a destructive banner, as a failed automation run is
 * shown: the one-line reason as its title, what to do beneath it, and the
 * stored reason itself — the embedding provider's own sentence inline (the
 * crawl action keeps it to one), any other dump (sandbox JSON, DNS syscalls)
 * folded under "Technical details". The reason used to sit on `title`
 * alone, under a muted caption, where nobody found it.
 */
export function WebsiteScanFailureAlert({
  kind,
  reason,
  sourceKind,
  empty = false,
}: WebsiteScanFailureAlertProps) {
  const { t } = useT('websites');
  const detail = reason === null ? '' : scanErrorDetail(reason);
  const embedding = kind === 'embedding';
  return (
    <Alert
      variant="destructive"
      title={t(scanErrorMessageKey(kind, sourceKind))}
      description={
        <Stack gap={1}>
          {empty ? (
            <Text>{t(scanEmptyMessageKey(kind, sourceKind))}</Text>
          ) : null}
          {embedding ? (
            <Text>
              {t(
                embeddingHintKey(
                  reason === null ? null : embeddingFailureClass(reason),
                ),
              )}
            </Text>
          ) : null}
          {detail === '' ? null : embedding ? (
            <Text>{detail}</Text>
          ) : (
            <CollapsibleDetails
              summary={t('viewDialog.technicalDetails')}
              variant="compact"
            >
              <Text
                variant="code"
                className="mt-1 break-all whitespace-pre-wrap"
              >
                {detail}
              </Text>
            </CollapsibleDetails>
          )}
        </Stack>
      }
    />
  );
}
