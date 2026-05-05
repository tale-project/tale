export type Region = 'CH' | 'DE';

export const REGIONS = ['CH', 'DE'] as const;

export const REGION_CURRENCY: Record<Region, 'CHF' | 'EUR'> = {
  CH: 'CHF',
  DE: 'EUR',
};

export const REGION_FORMAT_LOCALE: Record<Region, string> = {
  CH: 'de-CH',
  DE: 'de-DE',
};

export function detectDefaultRegion(): Region {
  if (typeof navigator === 'undefined') return 'CH';
  const tag = navigator.language ?? '';
  const region = tag.split('-')[1]?.toUpperCase();
  if (region === 'CH') return 'CH';
  if (region === 'DE' || region === 'AT') return 'DE';
  return 'CH';
}
