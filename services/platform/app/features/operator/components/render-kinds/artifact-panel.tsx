'use client';

/** `artifact` — a produced payload. `params.display` (blob | object | code |
 * embed) folds file-card / object-card / code / iframe-media into one kind. */
import { Button } from '@tale/ui/button';
import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';

import { JsonViewer } from '@/app/components/ui/data-display/json-viewer';
import { useT } from '@/lib/i18n/client';
import type { ArtifactDisplay } from '@/lib/shared/platform/render_kinds';

import { parseDocumentArtifact } from '../../lib/document-artifact';
import { asRecord, pickString } from '../../lib/output-helpers';
import type { RenderPart } from '../../types';
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

function DocumentArtifactSummary({
  part,
  title,
  action,
}: {
  part: RenderPart;
  title: string;
  action: 'created' | 'updated' | 'skipped';
}) {
  const { t } = useT('operator');
  const url =
    part.files?.find((f) => f.name === title)?.url ??
    part.files?.[0]?.url ??
    pickString(asRecord(part.data), 'url', 'href', 'link', 'downloadUrl');

  const label =
    action === 'created'
      ? t('artifact.filed', { title, defaultValue: `Filed ${title}` })
      : action === 'updated'
        ? t('artifact.updated', { title, defaultValue: `Updated ${title}` })
        : t('artifact.unchanged', {
            title,
            defaultValue: `${title} already up to date`,
          });

  return (
    <VStack gap={2}>
      <Text as="span">{label}</Text>
      {url !== undefined && (
        <Button asChild variant="secondary">
          <a href={url} target="_blank" rel="noopener noreferrer">
            {t('action.open')}
          </a>
        </Button>
      )}
    </VStack>
  );
}

export function ArtifactPanel({ part }: { part: RenderPart }) {
  const { t } = useT('operator');
  const out = asRecord(part.data);
  const display = resolveDisplay(part.params?.display);
  const url = pickString(out, 'url', 'href', 'link', 'downloadUrl');

  if (display === 'blob' || display === 'embed') {
    if (url) {
      const label = pickString(out, 'name', 'title') ?? url;
      return (
        <VStack gap={2}>
          <Text as="span" truncate>
            {label}
          </Text>
          <Button asChild variant="secondary">
            <a href={url} target="_blank" rel="noopener noreferrer">
              {t('action.open')}
            </a>
          </Button>
        </VStack>
      );
    }
    return <OutputFallback part={part} />;
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

  const doc = parseDocumentArtifact(part.data);
  if (doc) {
    return (
      <DocumentArtifactSummary
        part={part}
        title={doc.title}
        action={doc.action}
      />
    );
  }

  // Unrecognized object: no raw JSON by default — muted note + disclosure.
  if (part.data !== undefined && part.data !== null) {
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

  return <OutputFallback part={part} />;
}
