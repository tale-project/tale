import { AppShell } from '@tale/ui/app-shell';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';

import { DemoShell } from './demo-shell';

describe('DemoShell a11y / SEO contract', () => {
  it('exposes one labelled image and hides decorative DOM from AT + snippets', () => {
    const label =
      'Animated demo: a labelled product illustration for assistive tech.';
    render(
      <AppShell i18n={i18n}>
        <DemoShell label={label} activeNav="chat">
          <p>Scenario copy that must not be page text</p>
        </DemoShell>
      </AppShell>,
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
});
