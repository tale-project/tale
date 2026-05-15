import type { LocaleConfig } from '../types';

export const bn: LocaleConfig = {
  locale: 'bn',
  name: 'Bengali',
  scripts: ['beng', 'latn'],
  countries: ['BD', 'IN'],
  phoneContextKeywords: ['ফোন', 'মোবাইল', 'নম্বর', 'tel.', 'tel'],
  cvcContextKeywords: ['নিরাপত্তা কোড', 'cvc', 'cvv', 'cv2'],
  address: {
    forms: ['standard', 'po-box'],
    postcodeForm: 'continental',
    postcodeRegex: '\\d{4}',
    requireUppercase: true,
    streetKeywordsStandard: ['Road', 'Rd.', 'Lane', 'Street', 'St.', 'Sarani'],
    poBoxKeywords: ['P.O. Box', 'PO Box'],
    floorKeywords: ['Floor', 'Apartment', 'Flat'],
    countryNames: ['বাংলাদেশ', 'Bangladesh', 'India', 'BD', 'IN'],
    countryPostcodePrefixes: [],
  },
  nationalIds: [],
  dateOfBirth: {
    monthsLong: [
      'জানুয়ারি',
      'ফেব্রুয়ারি',
      'মার্চ',
      'এপ্রিল',
      'মে',
      'জুন',
      'জুলাই',
      'আগস্ট',
      'সেপ্টেম্বর',
      'অক্টোবর',
      'নভেম্বর',
      'ডিসেম্বর',
    ],
    contextKeywords: ['জন্ম তারিখ', 'জন্মদিন', 'জন্ম'],
  },
};
