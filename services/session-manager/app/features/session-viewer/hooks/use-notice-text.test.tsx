import { LOCALE_STORAGE_KEY } from '@tale/ui/i18n/detect-locale';
import { afterEach, describe, expect, it } from 'vitest';

import { NOTICE_CODES } from '@/lib/live-view';
import { renderHookApp } from '@/tests/utils/render';

import { useNoticeText } from './use-notice-text';

afterEach(() => {
  localStorage.removeItem(LOCALE_STORAGE_KEY);
});

function sentences(locale?: string) {
  if (locale !== undefined) localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  const { result } = renderHookApp(() => useNoticeText());
  return (code: (typeof NOTICE_CODES)[number]) =>
    result.current({ code, message: 'What the browser said' });
}

describe('useNoticeText', () => {
  it('has a sentence for every kind of notice the browser can raise', () => {
    const text = sentences();
    for (const code of NOTICE_CODES) {
      expect(text(code), code).not.toBe('');
      // A sentence of the app, not the key or the code that stands for it.
      expect(text(code), code).not.toMatch(/^notice\.|_/);
    }
  });

  it('says what went wrong in words, and quotes the browser only where it is all there is to say', () => {
    const text = sentences();
    expect(text('address_refused')).toBe(
      "That address can't be opened. Use one that starts with http:// or https://.",
    );
    expect(text('tab_gone')).toBe('That tab is already closed.');
    expect(text('tab_not_opened')).toBe(
      'Couldn\'t open a new tab: "What the browser said".',
    );
    expect(text('key_failed')).toBe(
      'Couldn\'t send that key to the page: "What the browser said".',
    );
    expect(text('action_failed')).toBe(
      'The browser said: "What the browser said".',
    );
  });

  it('says it in German, with the quotes of German', () => {
    const text = sentences('de');
    expect(text('address_refused')).toBe(
      'Diese Adresse lässt sich nicht öffnen. Verwende eine, die mit http:// oder https:// beginnt.',
    );
    expect(text('tab_gone')).toBe('Dieser Tab ist bereits geschlossen.');
    expect(text('tab_not_opened')).toBe(
      'Es konnte kein neuer Tab geöffnet werden: „What the browser said“.',
    );
    expect(text('key_failed')).toBe(
      'Die Taste konnte nicht an die Seite gesendet werden: „What the browser said“.',
    );
    expect(text('action_failed')).toBe(
      'Der Browser meldet: „What the browser said“.',
    );
  });

  it('says it in French, with its spaces before a colon and inside the quotes', () => {
    const text = sentences('fr');
    expect(text('address_refused')).toBe(
      "Impossible d'ouvrir cette adresse. Utilise une adresse qui commence par http:// ou https://.",
    );
    expect(text('tab_gone')).toBe('Cet onglet est déjà fermé.');
    // The spaces are no-break spaces, so that a line never ends before a colon or a closing guillemet.
    expect(text('tab_not_opened')).toBe(
      "Impossible d'ouvrir un nouvel onglet\u00a0: «\u00a0What the browser said\u00a0».",
    );
    expect(text('key_failed')).toBe(
      "Impossible d'envoyer cette touche à la page\u00a0: «\u00a0What the browser said\u00a0».",
    );
    expect(text('action_failed')).toBe(
      'Le navigateur indique\u00a0: «\u00a0What the browser said\u00a0».',
    );
  });
});
