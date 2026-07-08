// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { screen } from '@testing-library/react';
import { Position } from '@xyflow/react';
import type { CSSProperties, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render } from '@/tests/utils/render';

// BaseEdge/EdgeLabelRenderer need a live React Flow store; the label badge —
// what these tests assert — does not. Keep the pure path helpers real.
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...actual,
    BaseEdge: ({ path, style }: { path: string; style?: CSSProperties }) => (
      <svg>
        <path data-testid="base-edge" d={path} style={style} />
      </svg>
    ),
    EdgeLabelRenderer: ({ children }: { children: ReactNode }) => (
      <>{children}</>
    ),
  };
});

import { WorkflowEdge } from './workflow-edge';

const baseProps = {
  id: 'e-cond-target-yes',
  source: 'cond',
  target: 'next',
  sourceX: 0,
  sourceY: 0,
  targetX: 0,
  targetY: 200,
  sourcePosition: Position.Bottom,
  targetPosition: Position.Top,
};

// A routed path long enough (>= 90px) that the label badge is shown.
const longRoute = [
  { x: 0, y: 0 },
  { x: 0, y: 60 },
  { x: 120, y: 60 },
  { x: 120, y: 200 },
];

describe('WorkflowEdge branch label badge (#2370)', () => {
  it('renders a positive branch label with the success treatment', () => {
    render(
      <WorkflowEdge
        {...baseProps}
        data={{ label: 'Yes', labelVariant: 'positive', elkPoints: longRoute }}
      />,
    );

    const badge = screen.getByText('Yes');
    expect(badge).toHaveClass('text-success', 'border-success');
  });

  it('renders a negative branch label in amber — never the error red', () => {
    render(
      <WorkflowEdge
        {...baseProps}
        data={{ label: 'No', labelVariant: 'negative', elkPoints: longRoute }}
      />,
    );

    const badge = screen.getByText('No');
    expect(badge).toHaveClass('text-amber-700', 'border-warning');
    expect(badge).not.toHaveClass('text-destructive');
    expect(badge).not.toHaveClass('border-destructive');
  });

  it('falls back to the neutral treatment for a custom branch key', () => {
    render(
      <WorkflowEdge
        {...baseProps}
        data={{ label: 'Check Has Cursor', elkPoints: longRoute }}
      />,
    );

    expect(screen.getByText('Check Has Cursor')).toHaveClass(
      'text-muted-foreground',
    );
  });

  it('hides the label on a routed edge too short to fit it', () => {
    render(
      <WorkflowEdge
        {...baseProps}
        targetY={40}
        data={{
          label: 'Yes',
          labelVariant: 'positive',
          elkPoints: [
            { x: 0, y: 0 },
            { x: 0, y: 40 },
          ],
        }}
      />,
    );

    expect(screen.queryByText('Yes')).toBeNull();
  });
});
