import type { LocaleConfig } from '../types';

export const et: LocaleConfig = {
  locale: 'et',
  name: 'Estonian',
  scripts: ['latn'],
  countries: ['EE'],
  phoneContextKeywords: ['telefon', 'mobiil', 'number', 'tel.', 'tel'],
  cvcContextKeywords: ['turvakood', 'cvc', 'cvv', 'cv2'],
  address: {
    forms: ['glued-suffix', 'standalone-suffix', 'po-box'],
    postcodeForm: 'continental',
    postcodeRegex: '\\d{5}',
    requireUppercase: true,
    streetSuffixGlued: ['tee', 'tn', 'põik', 'plats', 'allee', 'väljak'],
    poBoxKeywords: ['Postkast', 'Pk'],
    floorKeywords: ['korter', 'korrus'],
    countryNames: ['Eesti', 'Estonia', 'EE'],
    countryPostcodePrefixes: [],
  },
  nationalIds: [],
  dateOfBirth: {
    monthsLong: [
      'jaanuar',
      'veebruar',
      'märts',
      'aprill',
      'mai',
      'juuni',
      'juuli',
      'august',
      'september',
      'oktoober',
      'november',
      'detsember',
    ],
    contextKeywords: ['sünnikuupäev', 'sünniaeg', 'sündinud'],
  },
};
