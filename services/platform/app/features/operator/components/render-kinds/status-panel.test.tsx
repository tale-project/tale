import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import type { RenderPart } from '../../types';
import { StatusPanel } from './status-panel';

function statusPart(overrides: Partial<RenderPart>): RenderPart {
  return {
    render: 'status',
    partState: 'output_available',
    title: 'Merge decision',
    data: undefined,
    ...overrides,
  };
}

describe('StatusPanel', () => {
  it('surfaces an affirmative gate verdict as a badge', () => {
    render(
      <StatusPanel part={statusPart({ treatment: 'gate', data: 'yes' })} />,
    );
    // No `verdictLabels` key → falls back to the operator catalog ("Yes").
    expect(screen.getByText('Yes')).toBeInTheDocument();
  });

  it('surfaces a needs-work gate verdict', () => {
    render(
      <StatusPanel part={statusPart({ treatment: 'gate', data: 'no' })} />,
    );
    expect(screen.getByText('No')).toBeInTheDocument();
  });

  it('resolves the verdict label from the platform automations catalog when provided', () => {
    render(
      <StatusPanel
        part={statusPart({
          treatment: 'gate',
          data: 'yes',
          params: {
            verdictLabels: { yes: 'folders.general' },
          },
        })}
      />,
    );
    expect(screen.getByText('General')).toBeInTheDocument();
  });

  it('shows a placeholder (no verdict) for a non-gate step, not low-value metadata', () => {
    render(
      <StatusPanel part={statusPart({ treatment: 'normal', data: 'yes' })} />,
    );
    expect(screen.queryByText('Yes')).not.toBeInTheDocument();
    expect(screen.getByText('No details to show.')).toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('passes axe for a gate verdict', async () => {
      const { container } = render(
        <StatusPanel part={statusPart({ treatment: 'gate', data: 'yes' })} />,
      );
      await checkAccessibility(container);
    });
  });
});
