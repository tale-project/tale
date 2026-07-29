// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { CatalogToolbar } from './catalog-toolbar';

describe('CatalogToolbar', () => {
  it('renders search only when no tabs or action are given', () => {
    render(
      <CatalogToolbar
        search={{
          value: '',
          onChange: vi.fn(),
          placeholder: 'Search things…',
        }}
      />,
    );
    expect(screen.getByPlaceholderText('Search things…')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('renders the tabs, search, and action slots together', () => {
    render(
      <CatalogToolbar
        tabs={{
          items: [
            { value: 'installed', label: 'Installed' },
            { value: 'all', label: 'All' },
          ],
          value: 'installed',
          onValueChange: vi.fn(),
        }}
        search={{ value: '', onChange: vi.fn(), placeholder: 'Search…' }}
        action={<button type="button">Add</button>}
      />,
    );
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Installed' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  it('propagates a tab change through onValueChange', async () => {
    const onValueChange = vi.fn();
    const { user } = render(
      <CatalogToolbar
        tabs={{
          items: [
            { value: 'installed', label: 'Installed' },
            { value: 'all', label: 'All' },
          ],
          value: 'installed',
          onValueChange,
        }}
        search={{ value: '', onChange: vi.fn(), placeholder: 'Search…' }}
      />,
    );
    await user.click(screen.getByRole('tab', { name: 'All' }));
    expect(onValueChange).toHaveBeenCalledWith('all');
  });

  it('forwards search input changes and the disabled state', async () => {
    const onChange = vi.fn();
    const { user } = render(
      <CatalogToolbar
        search={{ value: '', onChange, placeholder: 'Search…' }}
      />,
    );
    await user.type(screen.getByPlaceholderText('Search…'), 'a');
    expect(onChange).toHaveBeenCalled();
  });

  it('keeps facet filters with the search and the primary action apart from them', () => {
    render(
      <CatalogToolbar
        search={{ value: '', onChange: vi.fn(), placeholder: 'Search…' }}
        filters={<button type="button">Filter by tag</button>}
        action={<button type="button">Add</button>}
      />,
    );
    const search = screen.getByPlaceholderText('Search…');
    const filter = screen.getByRole('button', { name: 'Filter by tag' });
    const action = screen.getByRole('button', { name: 'Add' });
    // The facet narrows the grid like the search does, so they share one
    // cluster; the primary verb must sit outside it.
    const cluster = filter.parentElement;
    expect(cluster).toContainElement(search);
    expect(cluster).not.toContainElement(action);
  });

  it('disables the search input when asked', () => {
    render(
      <CatalogToolbar
        search={{
          value: '',
          onChange: vi.fn(),
          placeholder: 'Search…',
          disabled: true,
        }}
      />,
    );
    expect(screen.getByPlaceholderText('Search…')).toBeDisabled();
  });

  describe('accessibility', () => {
    it('passes axe audit with all slots', async () => {
      const { container } = render(
        <CatalogToolbar
          tabs={{
            items: [
              { value: 'installed', label: 'Installed' },
              { value: 'all', label: 'All' },
            ],
            value: 'installed',
            onValueChange: vi.fn(),
          }}
          search={{ value: '', onChange: vi.fn(), placeholder: 'Search…' }}
          action={<button type="button">Add</button>}
        />,
      );
      // Radix Tabs renders aria-controls referencing a lazy panel that
      // doesn't exist in JSDOM, causing a false positive.
      await checkAccessibility(container, {
        rules: { 'aria-valid-attr-value': { enabled: false } },
      });
    });
  });
});
