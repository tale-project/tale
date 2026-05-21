'use client';

// Canvas pane source view for `python_runnable` / `node_runnable`
// artifacts. Used to also embed the execution panel; that responsibility
// has moved up to `canvas-pane.tsx`'s `RunResultPanel` so the run state
// is a project-level fixture independent of the sidebar's active file.
// This component is now a thin source-only wrapper around
// `CanvasCodeRenderer`.

import type { Id } from '@/convex/_generated/dataModel';

import { CanvasCodeRenderer } from './canvas-code-renderer';

interface CanvasRunnableCodeRendererProps {
  artifactId: Id<'artifacts'>;
  /**
   * Path of the file the user has selected in the sidebar. Kept on the
   * prop surface for future per-file source-view affordances; the source
   * code itself is supplied via `source` so the parent (canvas-pane)
   * remains the single source of truth for what's currently displayed.
   */
  activePath: string;
  source: string;
  language: 'python' | 'node';
  isStreaming?: boolean;
}

function CanvasRunnableCodeRendererComponent({
  artifactId,
  activePath,
  source,
  language,
  isStreaming,
}: CanvasRunnableCodeRendererProps) {
  // `artifactId` and `activePath` are intentionally accepted but unused —
  // they keep the prop surface stable for callers and leave room for the
  // upcoming per-file source affordances (jump-to-definition,
  // run-this-file CTA, etc.) without re-threading props through
  // canvas-pane.
  void artifactId;
  void activePath;

  return (
    <CanvasCodeRenderer
      code={source}
      language={language}
      isEditing={false}
      isStreaming={isStreaming ?? false}
      onContentChange={() => {
        /* runnable canvas is read-only; LLM-driven via artifact_edit */
      }}
    />
  );
}

// No memo wrapper: the parent re-renders for every artifact-row patch
// (e.g. live `runProgress` during a run) and the props are inherently
// changing during streaming, so memo's shallow equality check would
// never pass. Keep this lean.
export const CanvasRunnableCodeRenderer = CanvasRunnableCodeRendererComponent;
