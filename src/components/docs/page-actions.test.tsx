import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import { PageActions } from './page-actions';

const MARKDOWN_URL = 'https://docs.tale.dev/platform/chat/basics.md';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PageActions', () => {
  it('copies the page markdown and confirms in place', async () => {
    // `userEvent.setup()` (inside `render`) installs a clipboard stub, so the
    // copy is read back from it rather than spied on.
    const { user } = render(
      <PageActions markdownUrl={MARKDOWN_URL} markdown="# Chat" />,
    );
    await user.click(screen.getByRole('button', { name: 'Copy page' }));
    expect(await navigator.clipboard.readText()).toBe('# Chat');
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Copied' }),
      ).toBeInTheDocument(),
    );
  });

  it('hides Copy page when there is no markdown to copy', () => {
    render(<PageActions markdownUrl={MARKDOWN_URL} markdown={null} />);
    expect(screen.queryByRole('button', { name: 'Copy page' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open in' })).toBeInTheDocument();
  });

  it('hands the markdown twin to a model from the Open in menu', async () => {
    const { user } = render(
      <PageActions markdownUrl={MARKDOWN_URL} markdown="# Chat" />,
    );
    await user.click(screen.getByRole('button', { name: 'Open in' }));
    const markdown = await screen.findByRole('menuitem', {
      name: 'View as Markdown',
    });
    expect(markdown.closest('a')).toHaveAttribute('href', MARKDOWN_URL);
    const claude = screen.getByRole('menuitem', { name: 'Open in Claude' });
    expect(claude.closest('a')?.getAttribute('href')).toContain(
      encodeURIComponent(MARKDOWN_URL),
    );
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <PageActions markdownUrl={MARKDOWN_URL} markdown="# Chat" />,
    );
    await checkAccessibility(container);
  });
});
