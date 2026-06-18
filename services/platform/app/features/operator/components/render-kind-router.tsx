'use client';

/**
 * Dispatch a render-part to exactly one render-kind panel. The switch is
 * exhaustive over the closed RenderKind union — a missing case is a COMPILE
 * error (the `never` assertion), so adding a render-kind to the vocabulary
 * forces a component here. Unknown/unannotated parts never reach this: callers
 * resolve them to `status` (graceful degradation).
 */
import type { RenderPart } from '../types';
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

export function RenderKindRouter({ part }: { part: RenderPart }) {
  switch (part.render) {
    case 'status':
      return <StatusPanel part={part} />;
    case 'ingest':
      return <IngestPanel part={part} />;
    case 'transform':
      return <TransformPanel part={part} />;
    case 'validation':
      return <ValidationPanel part={part} />;
    case 'reconciliation':
      return <ReconciliationPanel part={part} />;
    case 'diff':
      return <DiffPanel part={part} />;
    case 'collection':
      return <CollectionPanel part={part} />;
    case 'artifact':
      return <ArtifactPanel part={part} />;
    case 'stream':
      return <StreamPanel part={part} />;
    case 'review':
      return <ReviewPanel part={part} />;
    default: {
      // Exhaustiveness guard — a new RenderKind without a panel fails the build.
      const _exhaustive: never = part.render;
      return _exhaustive;
    }
  }
}
