// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { OperatorProjection } from '../types';
import { OperatorView } from './operator-view';

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue ?? key,
  }),
}));

vi.mock('./outcome-strip', () => ({
  OutcomeStrip: () => <div data-testid="outcome-strip">Outcome</div>,
}));

vi.mock('./stage-timeline', () => ({
  StageTimeline: () => <div data-testid="stage-timeline" />,
}));

vi.mock('./part-envelope', () => ({
  PartEnvelope: ({
    children,
    part,
  }: {
    children?: ReactNode;
    part: { title: string };
  }) => <div data-testid={`part-${part.title}`}>{children}</div>,
}));

vi.mock('./render-kind-router', () => ({
  RenderKindRouter: () => null,
}));

function projection(
  overrides: Partial<OperatorProjection> & {
    steps: OperatorProjection['steps'];
  },
): OperatorProjection {
  return {
    status: 'completed',
    startedAt: 1,
    stages: ['work', 'deliver'],
    ...overrides,
  };
}

describe('OperatorView layout', () => {
  it('keeps Outcome outside Run details and collapses process by default', () => {
    render(
      <OperatorView
        projection={projection({
          steps: [
            {
              stepSlug: 'publish',
              name: 'File return',
              stepType: 'action',
              render: 'artifact',
              partState: 'output_available',
              params: { surface: 'outcome' },
            },
            {
              stepSlug: 'work',
              name: 'Pipeline',
              stepType: 'sandbox',
              render: 'stream',
              partState: 'output_available',
            },
          ],
        })}
      />,
    );

    expect(screen.getByTestId('outcome-strip')).toBeInTheDocument();
    const details = screen.getByText('Run details').closest('details');
    expect(details).toBeTruthy();
    expect(details).not.toHaveAttribute('open');
    // Process body is inside the closed disclosure — timeline mounts there.
    expect(
      details?.querySelector('[data-testid="stage-timeline"]'),
    ).toBeTruthy();
  });

  it('pins waiting_human steps above Run details, always expanded', () => {
    render(
      <OperatorView
        projection={projection({
          status: 'running',
          steps: [
            {
              stepSlug: 'gate',
              name: 'Approve',
              stepType: 'human',
              render: 'gate',
              partState: 'waiting_human',
            },
            {
              stepSlug: 'work',
              name: 'Pipeline',
              stepType: 'sandbox',
              render: 'stream',
              partState: 'running',
            },
          ],
        })}
      />,
    );

    expect(screen.getByTestId('part-Approve')).toBeInTheDocument();
    const details = screen.getByText('Run details').closest('details');
    expect(details?.contains(screen.getByTestId('part-Approve'))).toBe(false);
  });
});
