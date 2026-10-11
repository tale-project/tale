// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { Plug } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { CatalogCard } from './catalog-grid';
import { CatalogLoadError, CatalogView } from './catalog-view';

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
      empty={{
        icon: Plug,
        title: 'No connectors yet',
        description: 'Add one to start.',
      }}
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

  it('offers an inline Try again control when onRetry is set', () => {
    const onRetry = vi.fn();
    renderView({
      isError: true,
      errorMessage: "Couldn't load the connectors.",
      onRetry,
    });
    screen.getByRole('button', { name: 'Try again' }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  // A refresh of rows that stay on screen keeps its alert up while the retry
  // runs: the retry reads busy there, and a focused one keeps focus.
  it('marks a running retry busy without dropping its focus', () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <CatalogLoadError message="Couldn't refresh." onRetry={onRetry} />,
    );
    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();

    rerender(
      <CatalogLoadError
        message="Couldn't refresh."
        onRetry={onRetry}
        isRetrying
      />,
    );
    const busy = screen.getByRole('button', { name: 'Try again' });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    expect(busy).not.toBeDisabled();
    expect(busy).toHaveFocus();
    busy.click();
    expect(onRetry).not.toHaveBeenCalled();
  });

  // #3814 review: keying the whole alert per failure re-created Try again,
  // so a focused retry lost its focus when a background refresh failed again.
  it('announces a new failure afresh without re-creating a focused Try again', () => {
    const { rerender } = render(
      <CatalogLoadError
        message="Couldn't refresh."
        onRetry={vi.fn()}
        failureKey={1}
      />,
    );
    const retry = screen.getByRole('button', { name: 'Try again' });
    const firstMessage = screen.getByText("Couldn't refresh.");
    retry.focus();

    rerender(
      <CatalogLoadError
        message="Couldn't refresh."
        onRetry={vi.fn()}
        failureKey={1}
        isRetrying
      />,
    );
    rerender(
      <CatalogLoadError
        message="Couldn't refresh."
        onRetry={vi.fn()}
        failureKey={2}
      />,
    );

    // The message is a new node inside the same live region — read again —
    // while the button is the same element and still holds focus.
    expect(screen.getByText("Couldn't refresh.")).not.toBe(firstMessage);
    expect(screen.getByRole('alert')).toContainElement(
      screen.getByText("Couldn't refresh."),
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBe(retry);
    expect(retry).toHaveFocus();
  });

  it('hands the focus it held to onFocusLost when it leaves', async () => {
    const onFocusLost = vi.fn();
    const { rerender } = render(
      <CatalogLoadError
        message="Couldn't refresh."
        onRetry={vi.fn()}
        onFocusLost={onFocusLost}
      />,
    );
    screen.getByRole('button', { name: 'Try again' }).focus();
    // A new callback on re-render is not the alert leaving.
    const next = vi.fn();
    rerender(
      <CatalogLoadError
        message="Couldn't refresh."
        onRetry={vi.fn()}
        onFocusLost={next}
      />,
    );
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(onFocusLost).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();

    rerender(<></>);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('leaves focus the reader moved elsewhere where it is', async () => {
    const onFocusLost = vi.fn();
    const { rerender } = render(
      <>
        <button type="button">Elsewhere</button>
        <CatalogLoadError
          message="Couldn't refresh."
          onRetry={vi.fn()}
          onFocusLost={onFocusLost}
        />
      </>,
    );
    screen.getByRole('button', { name: 'Try again' }).focus();
    screen.getByRole('button', { name: 'Elsewhere' }).focus();

    rerender(
      <>
        <button type="button">Elsewhere</button>
        {null}
      </>,
    );
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(onFocusLost).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
  });

  it('offers the create CTA only when nothing exists yet', () => {
    renderView({
      items: [],
      hasItems: false,
      empty: {
        icon: Plug,
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
        icon: Plug,
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
