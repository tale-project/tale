import type { LocaleConfig } from '../types';

export const zhHant: LocaleConfig = {
  locale: 'zh-Hant',
  name: 'Chinese (Traditional)',
  scripts: ['hant'],
  countries: ['TW', 'HK', 'MO'],
  phoneContextKeywords: ['電話', '手機', '聯絡電話', 'tel.', 'tel'],
  cvcContextKeywords: ['安全碼', 'cvc', 'cvv', 'cv2'],
  address: {
    forms: ['postcode-anchored', 'po-box'],
    postcodeForm: 'cn',
    postcodeRegex: '\\d{3}(?:\\d{2})?',
    countryNames: ['台灣', 'Taiwan', '香港', 'Hong Kong', '澳門', 'Macau'],
    countryPostcodePrefixes: [],
    poBoxKeywords: ['郵政信箱', '郵箱'],
    requireUppercase: false,
  },
  nationalIds: [
    {
      id: 'tw-id',
      name: 'Taiwan National ID',
      pattern: '\\b[A-Z][12]\\d{8}\\b',
      replacement: '[TW_ID]',
    },
    {
      id: 'hk-hkid',
      name: 'Hong Kong HKID',
      pattern: '\\b[A-Z]{1,2}\\d{6}\\(?[A0-9]\\)?\\b',
      checksum: 'hk-hkid',
      replacement: '[HK_HKID]',
    },
  ],
  dateOfBirth: {
    yearMarker: '年',
    monthMarker: '月',
    dayMarker: '日',
    contextKeywords: ['出生於', '出生日期', '生日', '生於'],
  },
};
