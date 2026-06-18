'use client';

/**
 * Dispatch a projected step to exactly one render-kind panel. The switch is
 * exhaustive over the closed RenderKind union — a missing case is a COMPILE
 * error (the `never` assertion), so adding a render-kind to the vocabulary
 * forces a component here. Unknown/unannotated steps never reach this: the
 * projection resolves them to `status` (graceful degradation).
 */
import type { StepProjection } from '../types';
import { ArtifactPanel } from './render-kinds/artifact-panel';
import { CollectionPanel } from './render-kinds/collection-panel';
import { DiffPanel } from './render-kinds/diff-panel';
import { IngestPanel } from './render-kinds/ingest-panel';
import { ReconciliationPanel } from './render-kinds/reconciliation-panel';
import { ReviewPanel } from './render-kinds/review-panel';
import { StatusPanel } from './render-kinds/status-panel';
import { StreamPanel } from './render-kinds/stream-panel';
import { TransformPanel } from './render-kinds/transform-panel';
import { ValidationPanel } from './render-kinds/validation-panel';

export function RenderKindRouter({ step }: { step: StepProjection }) {
  switch (step.render) {
    case 'status':
      return <StatusPanel step={step} />;
    case 'ingest':
      return <IngestPanel step={step} />;
    case 'transform':
      return <TransformPanel step={step} />;
    case 'validation':
      return <ValidationPanel step={step} />;
    case 'reconciliation':
      return <ReconciliationPanel step={step} />;
    case 'diff':
      return <DiffPanel step={step} />;
    case 'collection':
      return <CollectionPanel step={step} />;
    case 'artifact':
      return <ArtifactPanel step={step} />;
    case 'stream':
      return <StreamPanel step={step} />;
    case 'review':
      return <ReviewPanel step={step} />;
    default: {
      // Exhaustiveness guard — a new RenderKind without a panel fails the build.
      const _exhaustive: never = step.render;
      return _exhaustive;
    }
  }
}
