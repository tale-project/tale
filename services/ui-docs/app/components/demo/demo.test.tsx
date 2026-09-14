import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';

import { Demo } from './demo';

/**
 * `<Demo>` is the one tag this site adds to the shared markdown registry, and
 * the only place a reader meets a real component rather than a screenshot.
 * Three things have to hold: the registered example renders, an unknown name
 * is LOUD rather than silent, and the source is one keystroke away.
 */

describe('Demo', () => {
  it('renders the registered example on the preview surface', () => {
    render(<Demo name="button/variants" />);
    expect(screen.getByText('Live example')).toBeInTheDocument();
    // The real `@tale/ui` Button, not a picture of one.
    expect(screen.getByRole('button', { name: 'Primary' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Destructive' }),
    ).toBeInTheDocument();
  });

  it('reveals the source through the Code toggle', async () => {
    const user = userEvent.setup();
    const { container } = render(<Demo name="button/variants" />);

    const toggle = screen.getByRole('button', { name: 'Code' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelector('pre')).toBeNull();

    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Hide code' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    // The filename labels the block; the body is the demo's own source, pulled
    // lazily. Read it off the `<pre>` rather than by text query — the
    // highlighter splits the source across one span per line.
    expect(await screen.findByText('button/variants.tsx')).toBeInTheDocument();
    await waitFor(() => {
      expect(container.querySelector('pre')?.textContent ?? '').toContain(
        'export default function ButtonVariants',
      );
    });

    await user.click(screen.getByRole('button', { name: 'Hide code' }));
    expect(screen.getByRole('button', { name: 'Code' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('shouts about an unknown name instead of rendering nothing', () => {
    render(<Demo name="button/nope" />);
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Unknown demo')).toBeInTheDocument();
    expect(alert).toHaveTextContent('app/demos/button/nope.tsx');
    // No preview chrome at all — there is nothing to preview.
    expect(screen.queryByRole('button', { name: 'Code' })).toBeNull();
  });

  it('treats a missing name the same as an unknown one', () => {
    render(<Demo />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<Demo name="button/variants" />);
    await checkAccessibility(container);
  });

  it('has no accessibility violations on the error box', async () => {
    const { container } = render(<Demo name="button/nope" />);
    await checkAccessibility(container);
  });
});
