import { afterEach, describe, expect, it } from 'vitest';

import { resetLanguage, showLanguage } from '@/tests/utils/language';
import { renderHookApp } from '@/tests/utils/render';

import { useRegionName } from './use-region-name';

afterEach(resetLanguage);

describe('useRegionName', () => {
  it('names a country in the language of the person', async () => {
    const english = renderHookApp(useRegionName);
    expect(english.result.current('DE')).toBe('Germany');
    expect(english.result.current('us')).toBe('United States');
    english.unmount();

    await showLanguage('de');
    const german = renderHookApp(useRegionName);
    expect(german.result.current('DE')).toBe('Deutschland');
    german.unmount();

    await showLanguage('fr');
    const french = renderHookApp(useRegionName);
    expect(french.result.current('DE')).toBe('Allemagne');
  });

  it('reads a code that names no country, or none at all, as itself', () => {
    const { result } = renderHookApp(useRegionName);
    expect(result.current('XX')).toBe('XX');
    expect(result.current('DEU')).toBe('DEU');
    expect(result.current('')).toBe('');
  });
});
