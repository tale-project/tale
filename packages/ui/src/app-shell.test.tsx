import { waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLocale } from '@/i18n/locale-provider';
import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { AppShell } from './app-shell';

function createI18n() {
  const instance = i18next.createInstance();
  void instance.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {
      en: { translation: { hello: 'Hello' } },
      'de-DE': { translation: { hello: 'Hallo' } },
      'fr-FR': { translation: { hello: 'Bonjour' } },
    },
  });
  return instance;
}

beforeEach(() => {
  localStorage.clear();
});

describe('AppShell', () => {
  it('renders children inside the i18n tree when locale is omitted (URL-driven mode)', () => {
    const i18n = createI18n();

    function Greeting() {
      const { t } = useTranslation();
      return <span data-testid="greeting">{t('hello')}</span>;
    }

    render(
      <AppShell i18n={i18n}>
        <Greeting />
      </AppShell>,
    );

    expect(screen.getByTestId('greeting')).toHaveTextContent('Hello');
  });

  // The bridge is the whole reason AppShell exists — without it, the
  // language picker only updates its own copy and the i18n instance stays
  // on the previous language.
  it('bridges client-mode locale changes to the i18n instance', async () => {
    localStorage.setItem('user-locale', 'de-DE');
    const i18n = createI18n();

    function Greeting() {
      const { t } = useTranslation();
      return <span data-testid="greeting">{t('hello')}</span>;
    }

    render(
      <AppShell i18n={i18n} locale={{ mode: 'client' }}>
        <Greeting />
      </AppShell>,
    );

    await waitFor(() => {
      expect(i18n.language).toBe('de-DE');
    });
    expect(screen.getByTestId('greeting')).toHaveTextContent('Hallo');
  });

  it('invokes onChange with the detected locale on mount', async () => {
    localStorage.setItem('user-locale', 'fr-FR');
    const i18n = createI18n();
    const onChange = vi.fn();

    render(
      <AppShell i18n={i18n} locale={{ mode: 'client', onChange }}>
        <span data-testid="ready">ready</span>
      </AppShell>,
    );

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('fr-FR');
    });
  });

  it('exposes useLocale to children in client mode', () => {
    localStorage.setItem('user-locale', 'de-DE');
    const i18n = createI18n();

    function LocaleProbe() {
      const { locale } = useLocale();
      return <span data-testid="locale">{locale}</span>;
    }

    render(
      <AppShell i18n={i18n} locale={{ mode: 'client' }}>
        <LocaleProbe />
      </AppShell>,
    );

    expect(screen.getByTestId('locale')).toHaveTextContent('de-DE');
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const i18n = createI18n();
      const { container } = render(
        <AppShell i18n={i18n}>
          <main>
            <h1>Hello</h1>
          </main>
        </AppShell>,
      );
      await checkAccessibility(container);
    });
  });
});
