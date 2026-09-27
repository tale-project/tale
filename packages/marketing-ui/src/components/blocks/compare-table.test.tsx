import { describe, expect, it } from 'vitest';

import { render } from '@/tests/utils/render';

import { CompareTable } from './compare-table';

const tiers = [
  { key: 'small' as const, name: 'Quality node', cta: null },
  { key: 'large' as const, name: 'Performance node', cta: null },
];

describe('CompareTable', () => {
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
