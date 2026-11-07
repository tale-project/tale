import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

vi.mock('@tanstack/react-router', async () => {
  const { createRouterStub } = await import('@/tests/utils/router-stub');
  return createRouterStub('/platform/chat/basics');
});

const { DocsFooter } = await import('./docs-footer');

const PROPS = {
  legalLines: ['© 2026 Tale by Ruler GmbH', 'Tale is MIT licensed.'],
  baseUrl: '/docs',
  repositoryUrl: 'https://github.com/tale-project/tale',
};

describe('DocsFooter', () => {
  it('prints each legal line as its own paragraph', () => {
    render(<DocsFooter {...PROPS} />);
    const footer = screen.getByRole('contentinfo');
    for (const line of PROPS.legalLines) {
      expect(within(footer).getByText(line).tagName).toBe('P');
    }
  });

  it('links the machine-readable indexes beneath the deploy base', () => {
    render(<DocsFooter {...PROPS} />);
    expect(screen.getByRole('link', { name: 'llms.txt' })).toHaveAttribute(
      'href',
      '/docs/llms.txt',
    );
    expect(screen.getByRole('link', { name: 'llms-full.txt' })).toHaveAttribute(
      'href',
      '/docs/llms-full.txt',
    );
  });

  it('opens the repository in a new tab', () => {
    render(<DocsFooter {...PROPS} />);
    const github = screen.getByRole('link', { name: 'GitHub' });
    expect(github).toHaveAttribute('href', PROPS.repositoryUrl);
    expect(github).toHaveAttribute('target', '_blank');
    expect(github).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('offers the language switcher only to a multilingual site', () => {
    const { rerender } = render(<DocsFooter {...PROPS} />);
    expect(
      screen.queryByRole('button', { name: /Switch language/ }),
    ).toBeNull();
    rerender(<DocsFooter {...PROPS} showLanguageSwitcher />);
    expect(
      screen.getByRole('button', { name: /Switch language/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Switch theme' }),
    ).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <DocsFooter {...PROPS} showLanguageSwitcher />,
    );
    await checkAccessibility(container);
  });
});
