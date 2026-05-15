import type { LocaleConfig } from '../types';

export const ja: LocaleConfig = {
  locale: 'ja',
  name: 'Japanese',
  scripts: ['jpan'],
  countries: ['JP'],
  phoneContextKeywords: [
    '電話',
    '携帯',
    '携帯番号',
    '電話番号',
    'tel.',
    'tel',
    '電番',
  ],
  cvcContextKeywords: ['セキュリティコード', 'cvc', 'cvv', 'cv2'],
  address: {
    forms: ['postcode-anchored', 'po-box'],
    postcodeForm: 'jp',
    postcodeRegex: '\\d{3}-\\d{4}',
    countryNames: ['日本', 'Japan', 'JP'],
    countryPostcodePrefixes: [],
    poBoxKeywords: ['私書箱'],
    requireUppercase: false,
  },
  nationalIds: [
    {
      id: 'jp-my-number',
      name: 'Japanese Individual Number (My Number)',
      pattern: '\\b\\d{12}\\b',
      replacement: '[MY_NUMBER]',
    },
    {
      id: 'jp-passport',
      name: 'Japanese Passport Number',
      pattern: '\\b[A-Z]{2}\\d{7}\\b',
      replacement: '[PASSPORT]',
    },
  ],
  dateOfBirth: {
    yearMarker: '年',
    monthMarker: '月',
    dayMarker: '日',
    contextKeywords: ['生まれ', '誕生日', '生年月日'],
  },
};
