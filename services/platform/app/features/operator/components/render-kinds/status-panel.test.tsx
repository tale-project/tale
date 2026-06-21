import { describe, expect, it } from 'vitest';

import { AppRuntimeProvider } from '@/app/features/apps/runtime/app-runtime';
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
    // No pack provider → falls back to the operator catalog ("Yes").
    expect(screen.getByText('Yes')).toBeInTheDocument();
  });

  it('surfaces a needs-work gate verdict', () => {
    render(
      <StatusPanel part={statusPart({ treatment: 'gate', data: 'no' })} />,
    );
    expect(screen.getByText('No')).toBeInTheDocument();
  });

  it('resolves the verdict label from the pack catalog when provided', () => {
    render(
      <AppRuntimeProvider
        value={{
          organizationId: 'org_1',
          appSlug: 'issue-desk',
          allowlist: [],
          labels: { 'issueDesk.verdictReady': 'Ready to merge' },
        }}
      >
        <StatusPanel
          part={statusPart({
            treatment: 'gate',
            data: 'yes',
            params: { verdictLabels: { yes: 'issueDesk.verdictReady' } },
          })}
        />
      </AppRuntimeProvider>,
    );
    expect(screen.getByText('Ready to merge')).toBeInTheDocument();
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
