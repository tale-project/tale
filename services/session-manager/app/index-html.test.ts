import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

/*
 * The page's own shell, `index.html`: what a browser reads before any script
 * runs. A file it names that the service does not ship is not a 404: the server
 * answers every unknown address with the app, so the tab gets a web page where
 * it asked for an icon, and nothing says so.
 */

const root = resolve(import.meta.dirname, '..');
const shell = new DOMParser().parseFromString(
  readFileSync(join(root, 'index.html'), 'utf8'),
  'text/html',
);

/** Where the browser finds a file the shell names: Vite serves `public/` from the root. */
const shipped = (address: string) =>
  existsSync(join(root, 'public', address.split('?')[0] ?? ''));

describe('index.html', () => {
  it('names the app until a page has named itself', () => {
    expect(shell.title).toBe('Session Manager');
  });

  it('sets the font and its smoothing on the body, as the pages of the other Tale services do', () => {
    expect(shell.body.classList).toContain('font-sans');
    expect(shell.body.classList).toContain('antialiased');
  });

  it('links only files the service ships', () => {
    const addresses = [
      ...shell.querySelectorAll('link[href]'),
      ...shell.querySelectorAll('script[src]'),
    ]
      .map(
        (element) =>
          element.getAttribute('href') ?? element.getAttribute('src'),
      )
      .filter((address) => address?.startsWith('/'));

    // The one script is the app itself, which Vite builds and serves.
    const files = addresses.filter((address) => address !== '/app/main.tsx');
    expect(files.length).toBeGreaterThan(0);
    for (const address of files) {
      expect(shipped(address ?? ''), `${address} is in public/`).toBe(true);
    }
  });

  it('has no link to the text files for language models, which this service does not have', () => {
    expect(shell.querySelector('link[href*="llms"]')).toBeNull();
  });

  it('has the icon of Tale for light and for dark, under the ids the theme looks for', () => {
    // `ThemeAssets` flips the `media` of these when a person picks a theme the
    // system does not have, so a tab in a dark theme does not keep a light icon.
    const light = shell.getElementById('favicon-light');
    const dark = shell.getElementById('favicon-dark');
    expect(light?.getAttribute('href')).toBe('/favicon-light.png');
    expect(light?.getAttribute('media')).toBe('(prefers-color-scheme: light)');
    expect(dark?.getAttribute('href')).toBe('/favicon-dark.png');
    expect(dark?.getAttribute('media')).toBe('(prefers-color-scheme: dark)');
    expect(
      shell.querySelector('link[rel="icon"][href="/favicon.ico"]'),
    ).not.toBeNull();
  });

  it('colours the bar of a phone like the page, in light and in dark', () => {
    expect(shell.getElementById('theme-color')?.getAttribute('media')).toBe(
      '(prefers-color-scheme: light)',
    );
    expect(
      shell.getElementById('theme-color-dark')?.getAttribute('media'),
    ).toBe('(prefers-color-scheme: dark)');
  });
});

describe('index.html on a phone', () => {
  const viewport = shell
    .querySelector('meta[name="viewport"]')
    ?.getAttribute('content')
    ?.split(',')
    .map((part) => part.trim());

  it('lays the page out to the width of the screen', () => {
    expect(viewport).toContain('width=device-width');
    expect(viewport).toContain('initial-scale=1');
  });

  it('reaches the edges of the screen, which the safe-area insets of the shell then keep clear of', () => {
    expect(viewport).toContain('viewport-fit=cover');
  });

  it('shrinks the page, not just the view of it, when the keyboard opens', () => {
    expect(viewport).toContain('interactive-widget=resizes-content');
  });
});

describe('index.html: an app that is not installed', () => {
  it('has no manifest: the app is no installable one, and a link to one would say it is', () => {
    expect(shell.querySelector('link[rel="manifest"]')).toBeNull();
    expect(existsSync(join(root, 'public', 'manifest.webmanifest'))).toBe(
      false,
    );
  });
});

/*
 * The theme is set by a script in the page, before the first paint: the app
 * (`ThemeProvider`) applies it only once it has mounted, and until then a
 * person on Dark would see the light palette, and a light tab icon, flash by.
 */
describe('index.html sets the theme before the first paint', () => {
  const script = [...shell.querySelectorAll('script:not([src])')].find(
    (element) => element.textContent.includes('tale-theme'),
  );

  /** Runs the script as a browser does, on a copy of the shell, with what it stored and what the system prefers. */
  function runWith({
    stored,
    systemIsDark,
    storage = 'works',
  }: {
    stored: string | null;
    systemIsDark: boolean;
    storage?: 'works' | 'blocked';
  }) {
    const page = new DOMParser().parseFromString(
      shell.documentElement.outerHTML,
      'text/html',
    );
    const read = (key: string) => {
      if (storage === 'blocked') throw new Error('The storage is blocked.');
      return key === 'tale-theme' ? stored : null;
    };
    runInNewContext(script?.textContent ?? '', {
      document: page,
      localStorage: { getItem: read },
      window: {
        matchMedia: (query: string) => ({
          matches: systemIsDark && query === '(prefers-color-scheme: dark)',
        }),
      },
      console: { warn: () => {} },
    });
    const html = page.documentElement;
    const media = (id: string) =>
      page.getElementById(id)?.getAttribute('media');
    return {
      isDark: html.classList.contains('dark'),
      colorScheme: html.style.colorScheme,
      faviconLight: media('favicon-light'),
      faviconDark: media('favicon-dark'),
      themeColorLight: media('theme-color'),
      themeColorDark: media('theme-color-dark'),
    };
  }

  it('is a script in the page itself, before the app is loaded', () => {
    expect(script).toBeDefined();
    const app = shell.querySelector('script[src="/app/main.tsx"]');
    expect(app).not.toBeNull();
    if (script === undefined || app === null) return;
    expect(
      script.compareDocumentPosition(app) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('reads the key the theme provider stores the choice under, and pins what it needs by their ids', () => {
    expect(script?.textContent).toContain("'tale-theme'");
    for (const id of [
      'favicon-light',
      'favicon-dark',
      'theme-color',
      'theme-color-dark',
    ]) {
      expect(shell.getElementById(id), `#${id} is in the page`).not.toBeNull();
    }
  });

  it('paints Dark for a person who chose it, though the system is light', () => {
    expect(runWith({ stored: 'dark', systemIsDark: false })).toEqual({
      isDark: true,
      colorScheme: 'dark',
      faviconLight: 'not all',
      faviconDark: 'all',
      themeColorLight: 'not all',
      themeColorDark: 'all',
    });
  });

  it('paints Light for a person who chose it, though the system is dark', () => {
    expect(runWith({ stored: 'light', systemIsDark: true })).toEqual({
      isDark: false,
      colorScheme: 'light',
      faviconLight: 'all',
      faviconDark: 'not all',
      themeColorLight: 'all',
      themeColorDark: 'not all',
    });
  });

  it.each([
    ['nothing stored', null],
    ['System chosen', 'system'],
    ['a value that is no theme', 'sepia'],
  ])('follows the system for %s', (_what, stored) => {
    expect(runWith({ stored, systemIsDark: true }).isDark).toBe(true);
    expect(runWith({ stored, systemIsDark: false }).isDark).toBe(false);
    expect(runWith({ stored, systemIsDark: true }).colorScheme).toBe('dark');
    expect(runWith({ stored, systemIsDark: false }).colorScheme).toBe('light');
  });

  it('leaves the page to the app, and does not fail, in a browser that blocks its storage', () => {
    expect(() =>
      runWith({ stored: null, systemIsDark: true, storage: 'blocked' }),
    ).not.toThrow();
  });
});
