import { afterEach, describe, expect, it } from 'vitest';

import { resetLanguage, showLanguage } from '@/tests/utils/language';
import { renderHookApp } from '@/tests/utils/render';

import { PROXY_PARSE_CODES } from '../../../../backend/domains/proxies/parsing';
import { useParseErrorText } from './use-parse-error-text';

afterEach(resetLanguage);

const ENGLISH = 'the backend sentence';

/** The values a reason names: only these two codes have parameters. */
const PARAMS: Record<string, Record<string, string | number>> = {
  invalid_port_value: { port: '99999' },
  line_too_long: { max: 4096 },
};

describe('useParseErrorText', () => {
  it.each(['en', 'de', 'fr'] as const)(
    'words every reason the backend can give, in %s',
    async (language) => {
      await showLanguage(language);
      const { result } = renderHookApp(useParseErrorText);

      for (const code of PROXY_PARSE_CODES) {
        const text = result.current(code, PARAMS[code] ?? {}, ENGLISH);
        // The backend's own sentence is what an unworded code falls back on:
        // a reason that shows it is missing from the catalog.
        expect(text, code).not.toBe(ENGLISH);
        expect(text, code).not.toContain('parseErrors.');
        expect(text, code).not.toMatch(/[{}]/);
        expect(text.length, code).toBeGreaterThan(10);
      }
    },
  );

  it('words a reason with the values it names', () => {
    const { result } = renderHookApp(useParseErrorText);
    expect(
      result.current('invalid_port_value', { port: '99999' }, ENGLISH),
    ).toBe('Invalid port 99999. A port is a number from 1 to 65535.');
    expect(result.current('line_too_long', { max: 4096 }, ENGLISH)).toBe(
      'The line is too long (over 4,096 characters).',
    );
    expect(result.current('missing_port', {}, ENGLISH)).toBe(
      'The port is missing. Write the proxy as host:port.',
    );
  });

  it('words it in German and French, with the numbers in their style', async () => {
    await showLanguage('de');
    const german = renderHookApp(useParseErrorText);
    expect(
      german.result.current('invalid_port_value', { port: '99999' }, ENGLISH),
    ).toBe('Ungültiger Port 99999. Ein Port ist eine Zahl von 1 bis 65535.');
    expect(german.result.current('line_too_long', { max: 4096 }, ENGLISH)).toBe(
      'Die Zeile ist zu lang (mehr als 4.096 Zeichen).',
    );
    german.unmount();

    await showLanguage('fr');
    const french = renderHookApp(useParseErrorText);
    expect(french.result.current('missing_port', {}, ENGLISH)).toBe(
      'Le port est manquant. Écris le proxy sous la forme host:port.',
    );
  });

  it('shows the backend sentence of a reason it has no words for', () => {
    const { result } = renderHookApp(useParseErrorText);
    expect(result.current('a_reason_from_the_future', {}, ENGLISH)).toBe(
      ENGLISH,
    );
  });

  it('does not print a placeholder when the value a reason names is missing', () => {
    const { result } = renderHookApp(useParseErrorText);
    // Without the port as typed, the general sentence says the same.
    expect(result.current('invalid_port_value', {}, ENGLISH)).toBe(
      'The port must be a number from 1 to 65535.',
    );
    // With nothing to say about the limit, the backend's sentence stands.
    expect(result.current('line_too_long', {}, ENGLISH)).toBe(ENGLISH);
  });
});
