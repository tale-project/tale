'use client';

/** Shared graceful fallback: show the raw step output (when present) so a panel
 * whose pack output doesn't match the expected shape still surfaces something
 * rather than rendering blank. */
import { Text } from '@tale/ui/text';

import { JsonViewer } from '@/app/components/ui/data-display/json-viewer';
import { useT } from '@/lib/i18n/client';

import type { RenderPart } from '../types';

export function OutputFallback({ part }: { part: RenderPart }) {
  const { t } = useT('operator');
  if (part.data === undefined || part.data === null) {
    return <Text variant="muted">{t('body.noDetails')}</Text>;
  }
  return <JsonViewer data={part.data} collapsed={1} />;
}
