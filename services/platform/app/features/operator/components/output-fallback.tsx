'use client';

/** Shared graceful fallback: show a muted placeholder, with raw step output
 * behind a disclosure so operators never face a wall of ids by default. */
import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';

import { JsonViewer } from '@/app/components/ui/data-display/json-viewer';
import { useT } from '@/lib/i18n/client';

import type { RenderPart } from '../types';

export function OutputFallback({ part }: { part: RenderPart }) {
  const { t } = useT('operator');
  if (part.data === undefined || part.data === null) {
    return <Text variant="muted">{t('body.noDetails')}</Text>;
  }
  return (
    <VStack gap={2}>
      <Text variant="muted">{t('body.noDetails')}</Text>
      <CollapsibleDetails
        variant="compact"
        summary={t('action.technicalDetails', {
          defaultValue: 'Technical details',
        })}
      >
        <div className="mt-2">
          <JsonViewer data={part.data} collapsed={1} />
        </div>
      </CollapsibleDetails>
    </VStack>
  );
}
