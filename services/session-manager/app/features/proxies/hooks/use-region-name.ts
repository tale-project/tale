import { useLocale } from '@tale/ui/i18n/locale-provider';
import { useMemo } from 'react';

/** What `Intl.DisplayNames` accepts as a region: two letters or three digits. */
const REGION_CODE = /^(?:[A-Z]{2}|\d{3})$/;

/**
 * The name of a country in the person's language ("Germany", "Deutschland"),
 * from its ISO code. A code that names no region reads as itself.
 */
export function useRegionName(): (code: string) => string {
  const { shownLocale } = useLocale();
  return useMemo(() => {
    const names = new Intl.DisplayNames([shownLocale], { type: 'region' });
    return (code) => {
      const region = code.toUpperCase();
      // `of` throws for an ill-formed region: only well-formed ones get there.
      return REGION_CODE.test(region) ? (names.of(region) ?? code) : code;
    };
  }, [shownLocale]);
}
