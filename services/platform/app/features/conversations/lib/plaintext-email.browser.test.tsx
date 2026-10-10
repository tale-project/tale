import { EmailPreview } from '@tale/ui/email-preview';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { plaintextToEmailHtml } from '@/lib/shared/conversations/plaintext-email';

afterEach(cleanup);

describe('bulk plaintext in the real EmailPreview', () => {
  it.each([
    'Use <price> from A&B.',
    '<script>alert("x")</script><b>bold</b>',
    'First line\n\nSecond line',
    '&lt;b&gt; already encoded',
  ])('preserves literal text and line breaks in %s', (text) => {
    const { container } = render(
      <EmailPreview html={plaintextToEmailHtml(text)} />,
    );
    const paragraph = container.querySelector('p');
    expect(paragraph?.innerText).toBe(text);
    expect(container.querySelectorAll('script, b, price')).toHaveLength(0);
  });

  it('continues to render intentional rich HTML', () => {
    const { container } = render(
      <EmailPreview html="<p><b>Bold</b><br>Second line</p>" />,
    );
    expect(container.querySelector('b')?.innerText).toBe('Bold');
    expect(container.querySelector('p')?.innerText).toBe('Bold\nSecond line');
  });
});
