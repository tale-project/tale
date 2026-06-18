'use client';

/** `artifact` — a produced payload. `params.display` (blob | object | code |
 * embed) folds file-card / object-card / code / iframe-media into one kind. */
import { Button } from '@tale/ui/button';
import { VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';

import { JsonViewer } from '@/app/components/ui/data-display/json-viewer';
import { useT } from '@/lib/i18n/client';
import type { ArtifactDisplay } from '@/lib/shared/platform/render_kinds';

import { asRecord, pickString } from '../../lib/output-helpers';
import type { StepProjection } from '../../types';
import { OutputFallback } from '../output-fallback';

function resolveDisplay(value: string | undefined): ArtifactDisplay {
  if (
    value === 'blob' ||
    value === 'object' ||
    value === 'code' ||
    value === 'embed'
  ) {
    return value;
  }
  return 'object';
}

export function ArtifactPanel({ step }: { step: StepProjection }) {
  const { t } = useT('operator');
  const out = asRecord(step.output);
  const display = resolveDisplay(step.params?.display);
  const url = pickString(out, 'url', 'href', 'link', 'downloadUrl');

  if (display === 'blob' || display === 'embed') {
    if (url) {
      const label = pickString(out, 'name', 'title') ?? url;
      return (
        <VStack gap={2}>
          <Text as="span" truncate>
            {label}
          </Text>
          <Button asChild variant="secondary" size="sm">
            <a href={url} target="_blank" rel="noopener noreferrer">
              {t('action.open')}
            </a>
          </Button>
        </VStack>
      );
    }
    return <OutputFallback step={step} />;
  }

  if (display === 'code') {
    const code = pickString(out, 'code', 'content', 'text');
    if (code !== undefined) {
      return (
        <pre className="bg-muted overflow-x-auto rounded-md p-3 text-sm whitespace-pre-wrap">
          {code}
        </pre>
      );
    }
  }

  // `object` (and code/blob fallbacks): structured payload.
  return step.output !== undefined ? (
    <JsonViewer data={step.output} collapsed={1} />
  ) : (
    <OutputFallback step={step} />
  );
}
