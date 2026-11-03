import { afterEach, describe, expect, it } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';

import { documentTitle, pageHead } from './page-head';

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('documentTitle', () => {
  it('names the page, then the app, with a hyphen as the platform does', () => {
    expect(documentTitle('Sessions')).toBe('Sessions - Session Manager');
    expect(documentTitle('Page not found')).toBe(
      'Page not found - Session Manager',
    );
  });

  it('is the name of the app alone for a page that has no name of its own', () => {
    expect(documentTitle()).toBe('Session Manager');
    expect(documentTitle('')).toBe('Session Manager');
  });

  it('keeps the name of a session as it was given, whatever it contains', () => {
    expect(documentTitle('Shop – Berlin · 2')).toBe(
      'Shop – Berlin · 2 - Session Manager',
    );
  });
});

describe('pageHead', () => {
  it('is the title a route puts in the head of the document', () => {
    expect(pageHead('Proxies')).toEqual({
      meta: [{ title: 'Proxies - Session Manager' }],
    });
    expect(pageHead()).toEqual({ meta: [{ title: 'Session Manager' }] });
  });

  it('is read anew in the language shown, as a route loads again after a change of language', async () => {
    await i18n.changeLanguage('de');
    expect(pageHead(i18n.t('navigation:sections.settings'))).toEqual({
      meta: [{ title: 'Einstellungen - Session Manager' }],
    });
  });
});
