'use client';

/**
 * Outcome strip — promotes steps annotated `ui.params.surface: "outcome"` into
 * a first-class, always-expanded section (peer of Input). Document artifacts
 * open via `DocumentPreviewDialog` (preview first, download from the dialog) —
 * same path as Documents / Project files. Non-document files with a resolved
 * storage URL keep a direct link as a fallback.
 */
import { Card } from '@tale/ui/card';
import { Row, VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { PackageCheck } from 'lucide-react';
import { useState } from 'react';

import { MarkdownContent } from '@/app/features/chat/components/message-bubble/markdown-renderer';
import { DocumentPreviewDialog } from '@/app/features/documents/components/document-preview-dialog';
import { useT } from '@/lib/i18n/client';
import { resolveSurface } from '@/lib/shared/platform/render_kinds';

import { parseDocumentArtifact } from '../lib/document-artifact';
import { asRecord, pickString } from '../lib/output-helpers';
import type { OperatorProjection, StepProjection } from '../types';

function outcomeSteps(projection: OperatorProjection): StepProjection[] {
  return projection.steps.filter(
    (s) => resolveSurface(s.params?.surface) === 'outcome',
  );
}

function stepTitle(step: StepProjection): string {
  const doc = parseDocumentArtifact(step.output);
  return doc?.title ?? step.name;
}

type PreviewTarget = {
  documentId?: string;
  fileId?: string;
  fileName: string;
};

type OutcomeEntry =
  | {
      kind: 'preview';
      key: string;
      name: string;
      documentId: string;
      fileId?: string;
    }
  | { kind: 'href'; key: string; name: string; url: string };

function entriesForReadySteps(ready: StepProjection[]): {
  entries: OutcomeEntry[];
  textOnly: StepProjection[];
} {
  const entries: OutcomeEntry[] = [];
  const covered = new Set<string>();

  for (const step of ready) {
    const doc = parseDocumentArtifact(step.output);
    if (doc) {
      covered.add(step.stepSlug);
      entries.push({
        kind: 'preview',
        key: step.stepSlug,
        name: doc.title,
        documentId: doc.documentId,
        fileId: doc.fileId,
      });
      continue;
    }
    for (const file of step.files ?? []) {
      covered.add(step.stepSlug);
      entries.push({
        kind: 'href',
        key: `${step.stepSlug}:${file.url}`,
        name: file.name,
        url: file.url,
      });
    }
  }

  const textOnly = ready.filter((step) => !covered.has(step.stepSlug));
  return { entries, textOnly };
}

const openClassName =
  'text-primary focus-visible:ring-primary rounded-sm font-medium underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:outline-none';

export function OutcomeStrip({
  projection,
}: {
  projection: OperatorProjection;
}) {
  const { t } = useT('operator');
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const steps = outcomeSteps(projection);
  // No pack annotation → omit entirely (not an empty card).
  if (steps.length === 0) return null;

  const errors = steps.filter((s) => s.partState === 'output_error');
  const ready = steps.filter((s) => s.partState === 'output_available');
  const pending = steps.filter(
    (s) =>
      s.partState === 'running' ||
      s.partState === 'loading' ||
      s.partState === 'queued_capacity' ||
      s.partState === 'waiting_external' ||
      s.partState === 'waiting_human',
  );
  // Publish steps often stay `upcoming` until late in the run — still reserve
  // the Outcome lane while the execution is in flight so operators know where
  // files will land.
  const runInFlight =
    projection.status === 'running' || projection.status === 'pending';
  const awaitingFiles =
    ready.length === 0 &&
    errors.length === 0 &&
    (pending.length > 0 || runInFlight);
  // A settled run with no outcome files/errors keeps the Outcome lane too — it
  // renders an empty-state placeholder rather than vanishing, so the section is
  // a stable peer of Input whether or not this run produced anything yet.
  const noOutputYet = ready.length === 0 && errors.length === 0;

  const { entries, textOnly } = entriesForReadySteps(ready);

  return (
    // Same chrome as automation BlockFrame / Input — always expanded, never
    // nested under a "Workflow run" disclosure.
    <Card asChild padding="none" shadow="sm">
      <section>
        <Row gap={3} align="start" justify="between" className="p-5 pb-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <Row
              gap={0}
              justify="center"
              className="bg-muted text-muted-foreground size-8 shrink-0 rounded-md"
            >
              <PackageCheck className="size-4" aria-hidden />
            </Row>
            <Text as="span" className="font-semibold">
              {t('section.outcome', { defaultValue: 'Outcome' })}
            </Text>
          </div>
        </Row>
        <VStack gap={3} className="px-5 pb-5">
          {noOutputYet && (
            <Text variant="muted">
              {awaitingFiles
                ? t('outcome.inProgress', {
                    defaultValue: 'Working — results will appear here.',
                  })
                : t('outcome.empty', {
                    defaultValue:
                      'No results yet — they will appear here once a run produces them.',
                  })}
            </Text>
          )}

          {errors.map((step) => (
            <Text
              key={step.stepSlug}
              variant="muted"
              className="text-destructive"
            >
              {step.node?.error ??
                t('outcome.failed', {
                  defaultValue: 'This step failed.',
                })}
            </Text>
          ))}

          {entries.length > 0 && (
            <ul className="flex flex-col gap-2">
              {entries.map((entry) => (
                <li key={entry.key}>
                  {entry.kind === 'preview' ? (
                    <button
                      type="button"
                      className={`${openClassName} border-none bg-transparent p-0 text-left`}
                      onClick={() =>
                        setPreview({
                          documentId: entry.documentId,
                          fileId: entry.fileId,
                          fileName: entry.name,
                        })
                      }
                    >
                      {entry.name}
                    </button>
                  ) : (
                    <a
                      href={entry.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={openClassName}
                    >
                      {entry.name}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}

          {textOnly.map((step) => {
            const summary = pickString(asRecord(step.output), 'summary');
            if (typeof summary === 'string' && summary.trim() !== '') {
              return <MarkdownContent key={step.stepSlug} content={summary} />;
            }
            return (
              <Text key={step.stepSlug} as="span" className="font-medium">
                {stepTitle(step)}
              </Text>
            );
          })}
        </VStack>

        <DocumentPreviewDialog
          open={preview !== null}
          onOpenChange={(open) => {
            if (!open) setPreview(null);
          }}
          documentId={preview?.documentId}
          fileId={preview?.fileId}
          fileName={preview?.fileName}
        />
      </section>
    </Card>
  );
}
