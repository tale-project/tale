import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { TooltipProvider } from '../overlays/tooltip';
import { FlowStepList } from './flow-step-list';
import {
  branchFlowGraph,
  reviewPullRequestsFlowGraph,
  syntheticFlowGraph,
  triageFlowGraph,
  triageInboxFlowGraph,
} from './testing/flow-fixtures';
import type { FlowGraph } from './types';
import { WorkflowCanvas, type WorkflowCanvasProps } from './workflow-canvas';

const meta: Meta<typeof WorkflowCanvas> = {
  title: 'Flow/WorkflowCanvas',
  component: WorkflowCanvas,
  tags: ['autodocs'],
  // Conditions show their full words in a tooltip, which needs a provider;
  // the app gets one from `AppShell`.
  decorators: [
    (Story) => (
      <TooltipProvider>
        <Story />
      </TooltipProvider>
    ),
  ],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: `
A workflow drawn from its data with an automatic ELK layout: Start, steps,
conditions with Yes and No, frames round iterating steps, End, and lines
along routes that never cross a box. One Tab stop, arrows follow the lines;
the List view says the same in text. See the guide on ui.tale.dev.
        `,
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof WorkflowCanvas>;

/** A canvas whose selection the story keeps, in a frame of its own size. */
function Selectable({
  graph,
  height = 720,
  ...props
}: Partial<WorkflowCanvasProps> & { graph: FlowGraph; height?: number }) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div style={{ height }} className="p-4">
      <WorkflowCanvas
        aria-label="Workflow"
        layoutKey="story"
        framed
        {...props}
        graph={graph}
        selectedId={selected}
        onSelect={setSelected}
      />
    </div>
  );
}

/** Triage GitHub issues: the long edge runs round Score's frame. */
export const Layout: Story = {
  render: () => (
    <Selectable
      graph={triageFlowGraph()}
      legend={[
        {
          id: 'data',
          swatch: { edge: 'data' },
          label: 'Reads the output above',
        },
        { id: 'exit', swatch: { edge: 'exit' }, label: 'The run returns it' },
        { id: 'frame', swatch: { node: 'frame' }, label: 'Runs once per item' },
      ]}
    />
  ),
};

/** If/else, an else-if, a step that goes on after failing, a repeat. */
export const Branches: Story = {
  render: () => <Selectable graph={branchFlowGraph()} height={900} />,
};

/** Three steps over the same list, a frame each. */
export const Frames: Story = {
  render: () => <Selectable graph={reviewPullRequestsFlowGraph()} />,
};

/** Problems marked on a condition, a step and End. */
export const Problems: Story = {
  render: () => (
    <Selectable
      graph={triageInboxFlowGraph()}
      issues={
        new Map([
          ['__gate:triage', { errors: 1, warnings: 0 }],
          ['propose', { errors: 0, warnings: 2 }],
          ['__end', { errors: 1, warnings: 0 }],
        ])
      }
    />
  ),
};

/** Forty nodes: shown from the top at a readable zoom. */
export const Large: Story = {
  render: () => <Selectable graph={syntheticFlowGraph(40)} />,
};

/** The same graph as a list. */
export const ListView: Story = {
  render: () => (
    <div className="max-w-md p-4">
      <FlowStepList graph={branchFlowGraph()} aria-label="Route a ticket" />
    </div>
  ),
};
