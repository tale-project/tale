import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { ThreadHeader, ThreadHeaderSeparator } from './thread-header';

describe('ThreadHeader', () => {
  it('lays out identity, title, context and actions in one row', () => {
    render(
      <ThreadHeader
        before={<button type="button">Back</button>}
        leading={<span data-testid="identity" />}
        title={<h1>Invoice #2231</h1>}
        meta={
          <>
            <span>Anna Meier</span>
            <ThreadHeaderSeparator />
            <span>2h ago</span>
          </>
        }
        actions={<button type="button">Assign</button>}
      />,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Invoice #2231' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Anna Meier')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assign' })).toBeInTheDocument();
    expect(screen.getByTestId('identity')).toBeInTheDocument();
  });

  it('keeps the page-header height and rule, or floats without the rule', () => {
    const { container, rerender } = render(<ThreadHeader title="Chat" />);
    const row = container.firstElementChild;
    expect(row).toHaveClass('h-13', 'border-b');

    rerender(<ThreadHeader title="Chat" floating />);
    expect(container.firstElementChild).toHaveClass('h-13');
    expect(container.firstElementChild).not.toHaveClass('border-b');
  });

  it('renders no context line when there is none', () => {
    const { container } = render(<ThreadHeader title="Chat" meta={false} />);
    expect(container.querySelectorAll('.text-xs')).toHaveLength(0);
  });

  it('keeps the separator out of the accessibility tree', () => {
    const { container } = render(<ThreadHeaderSeparator />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden');
  });

  it('passes an axe audit', async () => {
    const { container } = render(
      <ThreadHeader
        title={<h1>Quarterly report</h1>}
        meta={<span>Website relaunch</span>}
        actions={
          <button type="button" aria-label="More actions">
            …
          </button>
        }
      />,
    );
    await checkAccessibility(container);
  });
});
