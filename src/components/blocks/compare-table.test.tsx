import { describe, expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { CompareTable, LabelWithInfo } from './compare-table';

const tiers = [
  { key: 'small' as const, name: 'Quality node', cta: null },
  { key: 'large' as const, name: 'Performance node', cta: null },
];

describe('CompareTable', () => {
  it('lets a reader open comparison help with a tap and dismiss it with Escape', async () => {
    const { user } = render(
      <LabelWithInfo
        label="Memory"
        info="Memory is shared between running models."
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Memory' });
    await user.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Memory' })).toHaveTextContent(
      'Memory is shared between running models.',
    );
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('scrolls its card sideways on a phone instead of clipping a spec', () => {
    const { container } = render(
      <CompareTable
        caption="Hardware"
        tiers={tiers}
        rows={[
          {
            kind: 'data',
            label: 'RAM',
            cells: { small: '64GB (DDR5 ECC)', large: '96GB (GDDR7)' },
          },
        ]}
      />,
    );
    const table = container.querySelector('table');
    const card = table?.parentElement;
    // Content-sized columns below `sm`, the designed fixed columns from it:
    // an unbreakable spec never gets a cell narrower than itself…
    expect(table?.className).toContain('table-auto');
    expect(table?.className).toContain('sm:table-fixed');
    // …and a table wider than the phone scrolls inside its card, which is
    // the containing block of the sr-only caption.
    expect(card?.className).toContain('overflow-x-auto');
    expect(card?.className).toContain('relative');
    expect(card?.className).not.toContain('overflow-hidden');
  });
});
