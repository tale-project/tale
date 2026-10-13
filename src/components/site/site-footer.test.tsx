import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { render } from '@/tests/utils/render';

import { SiteFooter } from './site-footer';

// The switchers read the router; the link columns are what this suite is about.
vi.mock('@tale/ui/language-switcher', () => ({ LanguageSwitcher: () => null }));
vi.mock('@tale/ui/theme-switcher', () => ({ ThemeSwitcher: () => null }));

describe('SiteFooter', () => {
  it('lets a long link label break inside its half-phone-wide column', () => {
    render(
      <SiteFooter
        copyrightLines={['© Tale']}
        columns={[
          {
            heading: 'Rechtliches',
            links: [
              <a key="dpa" href="/legal/data-processing-agreement">
                Auftragsverarbeitungsvertrag
              </a>,
            ],
          },
        ]}
      />,
    );
    // A German compound has no break opportunity of its own: the list breaks
    // it where it must (hyphenated where the browser can) rather than letting
    // it run past the screen's edge.
    const list = screen.getByRole('list');
    expect(list.className).toContain('break-words');
    expect(list.className).toContain('hyphens-auto');
  });
});
