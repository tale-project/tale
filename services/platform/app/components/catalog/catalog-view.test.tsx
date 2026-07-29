// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { CatalogCard } from './catalog-grid';
import { CatalogView } from './catalog-view';

interface Row {
  slug: string;
}

const ITEMS: Row[] = [{ slug: 'github' }, { slug: 'slack' }];

function renderView(
  props: Partial<Parameters<typeof CatalogView<Row>>[0]> = {},
) {
  return render(
    <CatalogView<Row>
      isPending={false}
      items={ITEMS}
      hasItems
      itemKey={(row) => row.slug}
      renderItem={(row) => <CatalogCard title={row.slug} headingLevel={3} />}
      empty={{ title: 'No connectors yet', description: 'Add one to start.' }}
      {...props}
    />,
  );
}

describe('CatalogView', () => {
  it('renders a card per item once loaded', () => {
    renderView();
    expect(screen.getByRole('heading', { name: 'github' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'slack' })).toBeInTheDocument();
  });

  it('masks with a shape-matched skeleton while pending, showing no items', () => {
    renderView({ isPending: true });
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'github' }),
    ).not.toBeInTheDocument();
  });

  it('surfaces a listing failure instead of an empty grid', () => {
    renderView({ isError: true, errorMessage: 'catalog root missing' });
    expect(screen.getByText('catalog root missing')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'github' }),
    ).not.toBeInTheDocument();
  });

  it('offers the create CTA only when nothing exists yet', () => {
    renderView({
      items: [],
      hasItems: false,
      empty: {
        title: 'No connectors yet',
        description: 'Add one to start.',
        action: <button type="button">Add connector</button>,
      },
    });
    expect(
      screen.getByRole('heading', { name: 'No connectors yet' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Add connector' }),
    ).toBeInTheDocument();
  });

  it('shows the no-results state — never the create CTA — when filters exclude everything', () => {
    renderView({
      items: [],
      hasItems: true,
      empty: {
        title: 'No connectors yet',
        description: 'Add one to start.',
        action: <button type="button">Add connector</button>,
      },
    });
    // The reader already owns connectors; telling them to create one is wrong.
    expect(
      screen.queryByRole('button', { name: 'Add connector' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('No connectors yet')).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'No results found' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Try adjusting your search criteria'),
    ).toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('passes axe audit in the loaded state', async () => {
      const { container } = renderView();
      await checkAccessibility(container);
    });

    it('passes axe audit in both empty states', async () => {
      const zero = renderView({ items: [], hasItems: false });
      await checkAccessibility(zero.container);
      zero.unmount();
      const filtered = renderView({ items: [], hasItems: true });
      await checkAccessibility(filtered.container);
    });
  });
});
