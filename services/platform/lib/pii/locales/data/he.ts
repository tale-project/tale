import type { LocaleConfig } from '../types';

export const he: LocaleConfig = {
  locale: 'he',
  name: 'Hebrew',
  scripts: ['hebr'],
  countries: ['IL'],
  phoneContextKeywords: ['טלפון', 'נייד', 'פלאפון', 'tel.', 'tel'],
  cvcContextKeywords: ['קוד אבטחה', 'cvc', 'cvv', 'cv2'],
  address: {
    forms: ['inverted', 'po-box'],
    postcodeForm: 'continental',
    postcodeRegex: '\\d{7}',
    streetKeywordsInverted: ['רחוב', "רח'", 'שדרות', "שד'", 'כיכר'],
    houseNumberMarkers: ['מס׳', "מס'", 'no.'],
    poBoxKeywords: ['ת.ד.', 'תיבת דואר'],
    floorKeywords: ['דירה', 'קומה'],
    countryNames: ['ישראל', 'Israel', 'IL'],
    countryPostcodePrefixes: [],
    requireUppercase: false,
  },
  nationalIds: [
    {
      id: 'il-teudat-zehut',
      name: 'Israeli Teudat Zehut',
      pattern: '\\b\\d{9}\\b',
      checksum: 'il-teudat-zehut',
      replacement: '[IL_ID]',
    },
  ],
  dateOfBirth: {
    monthsLong: [
      'ינואר',
      'פברואר',
      'מרץ',
      'אפריל',
      'מאי',
      'יוני',
      'יולי',
      'אוגוסט',
      'ספטמבר',
      'אוקטובר',
      'נובמבר',
      'דצמבר',
    ],
    contextKeywords: ['תאריך לידה', 'נולד', 'נולדה', 'יום הולדת'],
  },
};
