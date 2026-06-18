'use client';

/** Shared graceful fallback: show the raw step output (when present) so a panel
 * whose pack output doesn't match the expected shape still surfaces something
 * rather than rendering blank. */
import { Text } from '@tale/ui/text';

import { JsonViewer } from '@/app/components/ui/data-display/json-viewer';
import { useT } from '@/lib/i18n/client';

import type { StepProjection } from '../types';

export function OutputFallback({ step }: { step: StepProjection }) {
  const { t } = useT('operator');
  if (step.output === undefined) {
    if (step.node?.outputUnavailable) {
      return <Text variant="muted">{t('body.outputUnavailable')}</Text>;
    }
    return <Text variant="muted">{t('body.noDetails')}</Text>;
  }
  return <JsonViewer data={step.output} collapsed={1} />;
}
