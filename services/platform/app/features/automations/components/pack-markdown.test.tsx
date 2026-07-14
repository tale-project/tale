import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { PackMarkdown } from './pack-markdown';

// The chat renderer module drags in the full message-bubble dependency tree;
// only its exported class string matters here.
vi.mock(
  '@/app/features/chat/components/message-bubble/markdown-renderer',
  () => ({ markdownWrapperStyles: '' }),
);

describe('PackMarkdown', () => {
  it('renders markdown structure (emphasis, lists) from pack strings', () => {
    render(<PackMarkdown text={'**Bold** intro\n\n- first\n- second'} />);
    expect(screen.getByText('Bold').tagName).toBe('STRONG');
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('renders a lone newline as a visible line break', () => {
    const { container } = render(
      <PackMarkdown text={'first line\nsecond line'} />,
    );
    expect(container.querySelector('br')).not.toBeNull();
  });

  it('keeps embedded HTML escaped (no rehype-raw)', () => {
    const { container } = render(
      <PackMarkdown text={'before <img src=x onerror=alert(1)> after'} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
