'use client';

/**
 * Outcome strip — promotes steps annotated `ui.params.surface: "outcome"` into
 * a first-class, always-expanded section (peer of Input). While a run is in
 * flight, every outcome step is a promised slot (muted name + pulse); once a
 * step lands, that row becomes the openable artifact. Document artifacts open
 * via `DocumentPreviewDialog` (preview first, download from the dialog) —
 * same path as Documents / Project files. Non-document files with a resolved
 * storage URL keep a direct link as a fallback.
 */
import { Card } from '@tale/ui/card';
import { Row, VStack } from '@tale/ui/layout';
import { StatusIndicator } from '@tale/ui/status-indicator';
import { Text } from '@tale/ui/text';
import { PackageCheck } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { MarkdownContent } from '@/app/features/chat/components/message-bubble/markdown-renderer';
import { DocumentPreviewDialog } from '@/app/features/documents/components/document-preview-dialog';
import { useT } from '@/lib/i18n/client';
import type { PartState } from '@/lib/shared/platform/part_state';
import { resolveSurface } from '@/lib/shared/platform/render_kinds';

import { parseDocumentArtifact } from '../lib/document-artifact';
import { asRecord, pickString } from '../lib/output-helpers';
import type { OperatorProjection, StepProjection } from '../types';

/** Steps annotated `ui.params.surface: "outcome"` — the shared outcome
 *  contract every host (desk card, task modal section) gates on. */
export function outcomeSteps(projection: OperatorProjection): StepProjection[] {
  return projection.steps.filter(
    (s) => resolveSurface(s.params?.surface) === 'outcome',
  );
}

function stepTitle(step: StepProjection): string {
  const doc = parseDocumentArtifact(step.output);
  return doc?.title ?? step.name;
}

/** Pending/skipped Outcome row label — pack-authored title when present. */
function slotLabel(step: StepProjection): string {
  return step.promisedTitle ?? step.name;
}

/** Step is actively working — show a slot even if projection status lagged. */
const ACTIVE_PENDING_STATES = new Set<PartState>([
  'running',
  'loading',
  'queued_capacity',
  'waiting_external',
  'waiting_human',
]);

/**
 * Promised deliverable rows. `skipped` always counts: a run can complete (or
 * park for operator input) after routing around earlier outcome steps — the
 * spine marks those `skipped`, but the Outcome lane still names what a later
 * successful pass will file. `upcoming` / `empty` only while the run is alive
 * (settled leftovers keep the empty copy).
 */
function isPendingSlot(step: StepProjection, runInFlight: boolean): boolean {
  if (
    step.partState === 'output_available' ||
    step.partState === 'output_error'
  ) {
    return false;
  }
  if (ACTIVE_PENDING_STATES.has(step.partState)) return true;
  if (step.partState === 'skipped') return true;
  if (!runInFlight) return false;
  return step.partState === 'upcoming' || step.partState === 'empty';
}

function slotShouldPulse(step: StepProjection, runInFlight: boolean): boolean {
  return runInFlight || ACTIVE_PENDING_STATES.has(step.partState);
}

/** True while any outcome slot is still pending — lets a host show its
 *  "Not ready yet." hint without re-walking the rows. */
export function outcomeHasPendingSlot(projection: OperatorProjection): boolean {
  const runInFlight =
    projection.status === 'running' || projection.status === 'pending';
  return outcomeSteps(projection).some((s) => isPendingSlot(s, runInFlight));
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

function entriesForReadyStep(step: StepProjection): {
  entries: OutcomeEntry[];
  textOnly: boolean;
} {
  const entries: OutcomeEntry[] = [];
  const doc = parseDocumentArtifact(step.output);
  if (doc) {
    entries.push({
      kind: 'preview',
      key: step.stepSlug,
      name: doc.title,
      documentId: doc.documentId,
      fileId: doc.fileId,
    });
    return { entries, textOnly: false };
  }
  for (const file of step.files ?? []) {
    entries.push({
      kind: 'href',
      key: `${step.stepSlug}:${file.url}`,
      name: file.name,
      url: file.url,
    });
  }
  return { entries, textOnly: entries.length === 0 };
}

const openClassName =
  'text-primary focus-visible:ring-primary rounded-sm font-medium underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:outline-none';

/**
 * Chrome-free outcome rows plus the shared preview dialog: ready artifacts
 * (document → preview dialog, plain file → link, text → markdown), failed
 * steps, and pending slots. Null when the pack annotates no outcome steps,
 * so a host gates its own chrome on the same contract. Hosts: the desk's
 * OutcomeStrip card, the task modal's Outcome section.
 */
export function OutcomeRows({
  projection,
}: {
  projection: OperatorProjection;
}) {
  const { t } = useT('operator');
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const steps = outcomeSteps(projection);
  if (steps.length === 0) return null;

  const runInFlight =
    projection.status === 'running' || projection.status === 'pending';

  const rows: ReactNode[] = [];
  let hasReadyOrError = false;
  let hasPendingSlot = false;

  for (const step of steps) {
    if (step.partState === 'output_error') {
      hasReadyOrError = true;
      rows.push(
        <li key={step.stepSlug}>
          <Text variant="muted" className="text-destructive">
            {step.node?.error ??
              t('outcome.failed', {
                defaultValue: 'This step failed.',
              })}
          </Text>
        </li>,
      );
      continue;
    }

    if (step.partState === 'output_available') {
      hasReadyOrError = true;
      const { entries, textOnly } = entriesForReadyStep(step);
      for (const entry of entries) {
        rows.push(
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
          </li>,
        );
      }
      if (textOnly) {
        const summary = pickString(asRecord(step.output), 'summary');
        rows.push(
          <li key={step.stepSlug}>
            {typeof summary === 'string' && summary.trim() !== '' ? (
              <MarkdownContent content={summary} />
            ) : (
              <Text as="span" className="font-medium">
                {stepTitle(step)}
              </Text>
            )}
          </li>,
        );
      }
      continue;
    }

    if (isPendingSlot(step, runInFlight)) {
      hasPendingSlot = true;
      const pulse = slotShouldPulse(step, runInFlight);
      rows.push(
        <li key={step.stepSlug}>
          <StatusIndicator variant="neutral" pulse={pulse} size="sm">
            {slotLabel(step)}
          </StatusIndicator>
        </li>,
      );
    }
  }

  const showSettledEmpty =
    !hasReadyOrError && !hasPendingSlot && rows.length === 0;

  return (
    <>
      {showSettledEmpty && (
        <Text variant="muted">
          {t('outcome.empty', {
            defaultValue:
              'No results yet — they will appear here once a run produces them.',
          })}
        </Text>
      )}

      {rows.length > 0 && (
        <ul
          className="flex flex-col gap-2"
          role={hasPendingSlot ? 'status' : undefined}
        >
          {rows}
        </ul>
      )}

      <DocumentPreviewDialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
        documentId={preview?.documentId}
        fileId={preview?.fileId}
        fileName={preview?.fileName}
      />
    </>
  );
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
  const hasPendingSlot = outcomeHasPendingSlot(projection);

  return (
    // Same chrome as automation BlockFrame / Input — always expanded, never
    // nested under a "Workflow run" disclosure.
    <Card asChild padding="none" shadow="sm">
      <section>
        <Row gap={3} align="center" justify="between" className="p-5 pb-3">
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
          {hasPendingSlot && (
            <Text variant="muted" className="shrink-0 text-sm">
              {t('outcome.pendingHint', {
                defaultValue: 'Not ready yet.',
              })}
            </Text>
          )}
        </Row>
        <VStack gap={3} className="px-5 pb-5">
          <OutcomeRows projection={projection} />
        </VStack>
      </section>
    </Card>
  );
}
