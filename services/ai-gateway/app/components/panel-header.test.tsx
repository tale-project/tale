import { LocaleProvider } from '@tale/ui/i18n/locale-provider';
import { TooltipProvider } from '@tale/ui/tooltip';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';

import { PanelHeader } from './panel-header';

// The two pickers read the app's router and theme provider, which the panel
// mounts above the screen; the strip itself has nothing to say about them.
vi.mock('@tale/ui/theme-switcher', () => ({ ThemeSwitcher: () => null }));
vi.mock('@tale/ui/language-switcher', () => ({ LanguageSwitcher: () => null }));

function show() {
  return render(
    <LocaleProvider>
      <TooltipProvider>
        <PanelHeader />
      </TooltipProvider>
    </LocaleProvider>,
  );
}

describe('PanelHeader', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('names the service in the type every platform page title is set in', () => {
    show();
    const title = screen.getByRole('heading', { level: 1, name: 'AI Gateway' });
    // `AdaptiveHeaderTitle`'s own classes — what "Automations" and
    // "Knowledge" carry — rather than a size and weight of this panel's own.
    expect(title.className).toContain('text-base');
    expect(title.className).toContain('font-semibold');
    expect(title.className).toContain('text-foreground');
  });

  it('carries no logo — the name beside it already says whose panel this is', () => {
    const { container } = show();
    // The only graphics left are the controls': the repository button's mark
    // is inside its link, and nothing floats loose beside the title where a
    // logo used to be.
    const loose = [...container.querySelectorAll('svg')].filter(
      (graphic) => graphic.closest('button, a') === null,
    );
    expect(loose).toEqual([]);
    expect(screen.queryByText('/')).toBeNull();
  });

  it('is one h-13 strip with its own bottom border, on the page’s own gutter', () => {
    const { container } = show();
    const strip = container.querySelector('header');
    expect(strip?.className).toContain('h-13');
    expect(strip?.className).toContain('border-b');
    // The table below keeps `px-4`; a wider gutter here would start the title
    // to the right of the first column on a large screen.
    expect(strip?.className).toContain('px-4');
    expect(strip?.className).not.toContain('lg:px-6');
  });

  it('keeps the repository button reachable by name', () => {
    show();
    const link = screen.getByRole('link', { name: 'GitHub' });
    expect(link.getAttribute('href')).toBe(
      'https://github.com/tale-project/tale',
    );
    expect(link.getAttribute('rel')).toContain('noopener');
  });
});
