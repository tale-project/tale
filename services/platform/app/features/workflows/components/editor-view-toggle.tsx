'use client';

/**
 * The Graph ⇄ Specification mode switch for the workflow editor — ONE icon
 * button whose icon and label always describe the view it switches TO. It
 * lives in the canvas's bottom-center toolbar (graph mode) and in the
 * same-styled floating bar over the text editor (specification mode), so
 * switching modes never moves the control. State persists via
 * `useWorkflowEditorView` (cookie) at the host.
 */
import { Button } from '@tale/ui/button';
import { HStack } from '@tale/ui/layout';
import { FileText, Workflow } from 'lucide-react';
import type { ReactNode } from 'react';

import { useT } from '@/lib/i18n/client';

export type WorkflowEditorView = 'graph' | 'specification';

export function EditorViewToggle({
  view,
  onViewChange,
}: {
  view: WorkflowEditorView;
  onViewChange: (view: WorkflowEditorView) => void;
}) {
  const { t } = useT('workflows');
  const toGraph = view === 'specification';
  const label = t(
    toGraph ? 'editorView.showGraph' : 'editorView.showSpecification',
  );
  const Icon = toGraph ? Workflow : FileText;
  return (
    <Button
      size="icon"
      variant="secondary"
      title={label}
      aria-label={label}
      onClick={() => onViewChange(toGraph ? 'graph' : 'specification')}
    >
      <Icon className="size-4" />
    </Button>
  );
}

/**
 * The specification view's floating bottom-center bar — the same pill chrome
 * as the canvas's `FlowCenterToolbar`, so the toggle sits in the identical
 * spot in both modes.
 */
export function EditorViewFloatingBar({ children }: { children: ReactNode }) {
  return (
    <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2">
      <HStack
        gap={2}
        className="ring-border bg-background rounded-lg p-1 shadow-sm ring-1"
      >
        {children}
      </HStack>
    </div>
  );
}
