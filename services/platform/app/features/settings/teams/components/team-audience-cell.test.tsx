// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { TeamAudienceCell } from './team-audience-cell';

const labels = {
  orgWide: 'Organization-wide',
  unknownTeam: 'Unknown team',
  more: (count: number) => `+${count}`,
};

const directory = new Map([
  ['team_a', 'Compliance'],
  ['team_b', 'Legal'],
  ['team_c', 'Finance'],
]);

function renderCell(teamIds: string[], isLoading = false) {
  return render(
    <TeamAudienceCell
      teamIds={teamIds}
      nameOf={(teamId) => directory.get(teamId)}
      labels={labels}
      isLoading={isLoading}
    />,
  );
}

describe('TeamAudienceCell', () => {
  it('passes axe audit', async () => {
    const { container } = renderCell(['team_a', 'team_b', 'team_c']);
    await checkAccessibility(container);
  });

  it('says organization-wide when the row names no team', () => {
    renderCell([]);

    expect(screen.getByText('Organization-wide')).toBeInTheDocument();
  });

  it('names a single-team audience with a chip and no fold', () => {
    renderCell(['team_a']);

    expect(screen.getByText('Compliance')).toBeInTheDocument();
    expect(screen.queryByText('+0')).not.toBeInTheDocument();
  });

  it('folds the audience past the first into a count only a reader sees past', () => {
    renderCell(['team_a', 'team_b', 'team_c']);

    // The `+2` is decoration; the names it stands for are what a screen
    // reader has to hear, and exactly once each.
    expect(screen.getByText('+2')).toHaveAttribute('aria-hidden');
    expect(screen.getByText('Legal, Finance')).toHaveClass('sr-only');
    // On the cell AND on the chip, which is what a pointer lands on.
    expect(screen.getAllByTitle('Compliance, Legal, Finance')).toHaveLength(2);
  });

  it('labels a team the directory no longer knows instead of dropping it', () => {
    // A cell that silently drops what it cannot name renders a restricted row
    // as having no audience at all — the opposite of the truth.
    renderCell(['team_gone']);

    expect(screen.getByText('Unknown team')).toBeInTheDocument();
    expect(screen.queryByText('team_gone')).not.toBeInTheDocument();
  });

  it('masks the names while the team directory is still loading', () => {
    // Without this the chips would spell "Unknown team" for a beat on every
    // row before the directory answers.
    const { container } = renderCell(['team_a'], true);

    expect(screen.queryByText('Compliance')).not.toBeInTheDocument();
    expect(screen.queryByText('Unknown team')).not.toBeInTheDocument();
    expect(container.querySelector('[data-skeleton-mask]')).toBeInTheDocument();
  });

  it('takes the shared icon-and-text slot rather than a hand-rolled one', () => {
    // The drift this locks: both audience columns were their own `gap-1`
    // inline-flex, which sat their text off every other list's.
    const { container } = renderCell(['team_a']);

    const slot = container.querySelector('svg')?.parentElement;
    expect(slot?.className).toContain('size-5');
    expect(slot?.parentElement?.className).toContain('gap-2');
  });
});
