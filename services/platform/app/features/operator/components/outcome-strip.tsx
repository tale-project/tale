'use client';

/**
 * Outcome strip — promotes steps annotated `ui.params.surface: "outcome"` into
 * a first-class, always-expanded section (peer of Input). Only meaningful
 * content: openable files, errors, in-progress, optional summary. No status
 * badges or "Filed / Open" double-labels — the link is the artifact.
 */
import { Card } from '@tale/ui/card';
import { Row, VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { PackageCheck } from 'lucide-react';

import { MarkdownContent } from '@/app/features/chat/components/message-bubble/markdown-renderer';
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

export function OutcomeStrip({
  projection,
}: {
  projection: OperatorProjection;
}) {
  const { t } = useT('operator');
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

  // Outcome lanes exist but nothing has started or finished yet — stay quiet.
  if (ready.length === 0 && errors.length === 0 && pending.length === 0) {
    return null;
  }

  const openable = ready.flatMap((step) =>
    (step.files ?? []).map((file) => ({
      key: `${step.stepSlug}:${file.url}`,
      name: file.name,
      url: file.url,
    })),
  );
  const textOnly = ready.filter((step) => (step.files?.length ?? 0) === 0);

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
          {ready.length === 0 && errors.length === 0 && pending.length > 0 && (
            <Text variant="muted">
              {t('outcome.inProgress', {
                defaultValue: 'Working — results will appear here.',
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

          {openable.length > 0 && (
            <ul className="flex flex-col gap-2">
              {openable.map((file) => (
                <li key={file.key}>
                  <a
                    href={file.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary focus-visible:ring-primary rounded-sm font-medium underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:outline-none"
                  >
                    {file.name}
                  </a>
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
      </section>
    </Card>
  );
}
