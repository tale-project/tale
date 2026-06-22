'use client';

/** `diff` — READ-ONLY before/after comparison (boundary vs reconciliation:
 * diff never acts). Renders `before`/`after` side by side. */
import { Grid, VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';

import { JsonViewer } from '@/app/components/ui/data-display/json-viewer';
import { useT } from '@/lib/i18n/client';

import { asRecord } from '../../lib/output-helpers';
import type { RenderPart } from '../../types';
import { OutputFallback } from '../output-fallback';

export function DiffPanel({ part }: { part: RenderPart }) {
  const { t } = useT('operator');
  const out = asRecord(part.data);
  const before = out?.before ?? out?.from ?? out?.previous;
  const after = out?.after ?? out?.to ?? out?.current;

  if (before === undefined && after === undefined) {
    return <OutputFallback part={part} />;
  }

  return (
    <Grid className="grid-cols-1 gap-3 sm:grid-cols-2">
      <VStack gap={1}>
        <Text as="span" variant="muted">
          {t('field.before')}
        </Text>
        <JsonViewer data={before} collapsed={1} />
      </VStack>
      <VStack gap={1}>
        <Text as="span" variant="muted">
          {t('field.after')}
        </Text>
        <JsonViewer data={after} collapsed={1} />
      </VStack>
    </Grid>
  );
}
