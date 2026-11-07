import { describe, expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { DemoShell } from './demo-shell';

describe('DemoShell a11y / SEO contract', () => {
  it('exposes one labelled image and hides decorative DOM from AT + snippets', () => {
    const label =
      'Animated demo: a labelled product illustration for assistive tech.';
    render(
      <DemoShell label={label} activeNav="chat">
        <p>Scenario copy that must not be page text</p>
      </DemoShell>,
    );

    const illustration = screen.getByRole('img', { name: label });
    expect(illustration.tagName).toBe('FIGURE');
    expect(illustration.getAttribute('data-nosnippet')).not.toBeNull();

    // Visible to querySelector (DOM still paints the mock) but not as
    // readable page content — aria-hidden + inert on the decorative payload.
    const payload = illustration.querySelector('[aria-hidden="true"]');
    expect(payload).not.toBeNull();
    expect(payload?.hasAttribute('inert')).toBe(true);
    expect(payload?.textContent).toContain(
      'Scenario copy that must not be page text',
    );
  });

  it('labels the chat chrome from the package catalog', () => {
    render(
      <DemoShell label="Chat demo" activeNav="chat">
        <p>thread</p>
      </DemoShell>,
    );

    // The Share label is the one string the frame renders on its own — it
    // must resolve from `src/i18n/messages`, never render as a raw key.
    const illustration = screen.getByRole('img', { name: 'Chat demo' });
    expect(illustration.textContent).toContain('Share');
    expect(illustration.textContent).not.toContain('chrome.share');
  });
});
