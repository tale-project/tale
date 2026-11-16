import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { ReadMore } from './read-more';

// jsdom has no layout: every box reads 0px tall. Give the clamped region a
// natural height so the component sees content longer (or shorter) than its
// limit; the real measurement is covered by read-more.browser.test.tsx.
function stubNaturalHeight(height: number, clientHeight = 0) {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(
    height,
  );
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(
    clientHeight,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ReadMore', () => {
  it('renders short content whole, with no toggle', () => {
    stubNaturalHeight(200);
    render(<ReadMore>Short note</ReadMore>);

    expect(screen.getByText('Short note')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('leaves content within the slack unclamped', () => {
    // 320px limit + 96px slack: 400px of content is shown whole.
    stubNaturalHeight(400);
    const { container } = render(<ReadMore>Almost long</ReadMore>);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(
      container.querySelector('[data-slot="read-more-content"]'),
    ).not.toHaveAttribute('data-clamped');
  });

  it('clamps long content and keeps every word in the DOM', () => {
    stubNaturalHeight(2000);
    const { container } = render(
      <ReadMore>
        <p>First paragraph</p>
        <p>Last paragraph</p>
      </ReadMore>,
    );

    const region = container.querySelector('[data-slot="read-more-content"]');
    expect(region).toHaveAttribute('data-clamped');
    expect(region).toHaveStyle({ maxHeight: '320px', overflow: 'hidden' });
    // Find-in-page and screen readers keep the full text.
    expect(screen.getByText('Last paragraph')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Read more' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('expands and collapses from the toggle, which controls the region', async () => {
    stubNaturalHeight(2000);
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    const { user, container } = render(<ReadMore>Long report</ReadMore>);
    const region = container.querySelector('[data-slot="read-more-content"]');

    const toggle = screen.getByRole('button', { name: 'Read more' });
    expect(toggle).toHaveAttribute('aria-controls', region?.id);
    expect(toggle).toHaveAttribute('type', 'button');

    await user.click(toggle);
    const less = screen.getByRole('button', { name: 'Show less' });
    expect(less).toHaveAttribute('aria-expanded', 'true');
    expect(region).not.toHaveAttribute('data-clamped');
    expect(region).not.toHaveStyle({ maxHeight: '320px' });

    await user.click(less);
    expect(screen.getByRole('button', { name: 'Read more' })).toHaveFocus();
    expect(region).toHaveAttribute('data-clamped');
    // Collapsing brings the toggle back into view.
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: 'nearest',
    });
  });

  it('honours a custom height and slack', () => {
    stubNaturalHeight(500);
    const { container } = render(
      <ReadMore maxHeight={384} slack={0}>
        Bubble text
      </ReadMore>,
    );
    expect(
      container.querySelector('[data-slot="read-more-content"]'),
    ).toHaveStyle({ maxHeight: '384px' });
  });

  it('clamps by lines and offers the toggle only when the text overflows', () => {
    stubNaturalHeight(120, 60);
    const { container } = render(<ReadMore lines={3}>A handbook</ReadMore>);

    const region = container.querySelector('[data-slot="read-more-content"]');
    expect(region).toHaveStyle({ overflow: 'hidden' });
    expect(region?.getAttribute('style')).toContain('-webkit-line-clamp: 3');
    expect(screen.getByRole('button', { name: 'Read more' })).toBeVisible();
  });

  it('works controlled and reports changes', async () => {
    stubNaturalHeight(2000);
    const onExpandedChange = vi.fn();
    const { user, rerender } = render(
      <ReadMore expanded={false} onExpandedChange={onExpandedChange}>
        Controlled
      </ReadMore>,
    );

    await user.click(screen.getByRole('button', { name: 'Read more' }));
    expect(onExpandedChange).toHaveBeenCalledWith(true);
    // Still collapsed until the owner says otherwise.
    expect(screen.getByRole('button', { name: 'Read more' })).toBeVisible();

    rerender(
      <ReadMore expanded onExpandedChange={onExpandedChange}>
        Controlled
      </ReadMore>,
    );
    expect(screen.getByRole('button', { name: 'Show less' })).toBeVisible();
  });

  it('takes custom labels and places the toggle at the end', () => {
    stubNaturalHeight(2000);
    render(
      <ReadMore labels={{ more: 'Show all', less: 'Show fewer' }} align="end">
        Long
      </ReadMore>,
    );
    expect(screen.getByRole('button', { name: 'Show all' })).toHaveClass(
      'self-end',
    );
  });

  it('fades into the given surface while clamped', () => {
    stubNaturalHeight(2000);
    const { container } = render(
      <ReadMore fadeClassName="from-muted">Long</ReadMore>,
    );
    const fade = container.querySelector('[aria-hidden].bg-gradient-to-t');
    expect(fade).toHaveClass('from-muted');
  });

  it('passes an axe audit, collapsed and expanded', async () => {
    stubNaturalHeight(2000);
    const { user, container } = render(
      <ReadMore>
        <p>An agent report that runs long.</p>
      </ReadMore>,
    );
    await checkAccessibility(container);
    await user.click(screen.getByRole('button', { name: 'Read more' }));
    await checkAccessibility(container);
  });
});
