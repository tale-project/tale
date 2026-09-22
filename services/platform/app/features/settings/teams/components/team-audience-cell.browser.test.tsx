import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { cleanup, render, screen } from '@/tests/utils/render';

import { TeamAudienceCell } from './team-audience-cell';

import '@/app/globals.css';

afterEach(cleanup);

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

/** The audience column's real width on both the documents and projects lists. */
const COLUMN_WIDTH = 160;

function renderCell(teamIds: string[]) {
  const view = render(
    <div style={{ width: COLUMN_WIDTH }}>
      <TeamAudienceCell
        teamIds={teamIds}
        nameOf={(teamId) => directory.get(teamId)}
        labels={labels}
      />
    </div>,
  );
  const slot = view.container.querySelector('svg')?.parentElement;
  if (slot?.nextElementSibling == null) {
    throw new Error('the cell rendered no glyph slot');
  }
  return {
    ...view,
    slot: slot.getBoundingClientRect(),
    content: slot.nextElementSibling.getBoundingClientRect(),
  };
}

describe('TeamAudienceCell (real layout)', () => {
  it.each([
    ['organization-wide', []],
    ['one named team', ['team_a']],
    ['a folded audience', ['team_a', 'team_b', 'team_c']],
  ])(
    'leaves exactly the shared 20px slot and 8px beside it — %s',
    async (_case, teamIds) => {
      await page.viewport(1280, 800);
      const { slot, content } = renderCell(teamIds as string[]);

      // The offset every other list's glyph-and-text cell uses. Measured
      // against the content box, not the ink: a chip carries its own padding
      // inside a box that still starts on the shared 8px.
      expect(slot.width).toBe(20);
      expect(content.left - slot.right).toBe(8);
    },
  );

  it('keeps the glyph while the chips give way in a full column', async () => {
    await page.viewport(1280, 800);
    const { slot } = renderCell(['team_a', 'team_b', 'team_c']);
    const countBox = screen.getByText('+2').getBoundingClientRect();

    // The glyph never shrinks and the folded count never spills out of the
    // 160px column — the chips are what truncate.
    expect(slot.width).toBe(20);
    expect(countBox.right).toBeLessThanOrEqual(slot.left + COLUMN_WIDTH);
  });
});
