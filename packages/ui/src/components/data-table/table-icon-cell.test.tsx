import { Badge } from '@tale/ui/badge';
import { Globe } from 'lucide-react';
import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { TableIconCell, tableIconCellSkeleton } from './table-icon-cell';

describe('TableIconCell', () => {
  it('passes axe audit', async () => {
    const { container } = render(
      <TableIconCell icon={<Globe />} label="tale.dev" />,
    );
    await checkAccessibility(container);
  });

  it('sizes and colours the glyph from the tile, not the caller', () => {
    // The drift this locks: three tables each hand-wrote `size-3` +
    // `text-muted-foreground` on their own icon. One owner now, so a glyph
    // handed over bare still lands at the shared size.
    const { container } = render(
      <TableIconCell icon={<Globe />} label="tale.dev" />,
    );

    const tile = container.querySelector('svg')?.parentElement;
    expect(tile?.className).toContain('[&_svg]:size-3');
    expect(tile?.className).toContain('text-muted-foreground');
    expect(tile).toHaveAttribute('aria-hidden');
  });

  it('renders badges beside the label and a caption under it', () => {
    render(
      <TableIconCell
        icon={<Globe />}
        label="Triage the Gmail inbox"
        badges={<Badge variant="outline">Gmail</Badge>}
        caption="gmail/triage-inbox"
      />,
    );

    expect(screen.getByText('Triage the Gmail inbox')).toBeInTheDocument();
    expect(screen.getByText('Gmail')).toBeInTheDocument();
    expect(screen.getByText('gmail/triage-inbox')).toBeInTheDocument();
  });

  it('omits the caption line entirely when no caption is given', () => {
    const { container } = render(
      <TableIconCell icon={<Globe />} label="tale.dev" />,
    );

    expect(
      container.querySelectorAll('span.text-muted-foreground'),
    ).toHaveLength(0);
  });

  it('carries the full value on the label for a truncated cell', () => {
    render(
      <TableIconCell
        icon={<Globe />}
        label="a-very-long-domain.example"
        title="a-very-long-domain.example"
      />,
    );

    expect(screen.getByText('a-very-long-domain.example')).toHaveAttribute(
      'title',
      'a-very-long-domain.example',
    );
  });
});

describe('tableIconCellSkeleton', () => {
  it('reserves the tile footprint rather than the bare-icon default', () => {
    // The skeleton renders `size-4` for an `icon-text` cell with no icon; the
    // tile is 20px, so an unspecified mask would make every row jump on load.
    const { container } = render(<>{tableIconCellSkeleton().icon}</>);

    expect(container.querySelector('.size-5')).not.toBeNull();
  });

  it('defaults to one line and takes a second on request', () => {
    expect(tableIconCellSkeleton().lines).toBe(1);
    expect(tableIconCellSkeleton({ lines: 2 }).lines).toBe(2);
    expect(tableIconCellSkeleton().type).toBe('icon-text');
  });
});
