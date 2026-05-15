import type { LocaleConfig } from '../types';

export const zhHans: LocaleConfig = {
  locale: 'zh-Hans',
  name: 'Chinese (Simplified)',
  scripts: ['hans'],
  countries: ['CN', 'SG'],
  phoneContextKeywords: ['电话', '手机', '联系电话', 'tel.', 'tel'],
  cvcContextKeywords: ['安全码', 'cvc', 'cvv', 'cv2'],
  address: {
    forms: ['postcode-anchored', 'po-box'],
    postcodeForm: 'cn',
    postcodeRegex: '\\d{6}',
    countryNames: ['中国', 'China', 'CN'],
    countryPostcodePrefixes: [],
    poBoxKeywords: ['邮政信箱', '邮箱'],
    requireUppercase: false,
  },
  nationalIds: [
    {
      id: 'cn-resident-id',
      name: 'Chinese Resident Identity Card',
      pattern: '\\b\\d{17}[\\dX]\\b',
      checksum: 'mod11-2-cn',
      replacement: '[CN_ID]',
    },
    {
      id: 'cn-passport',
      name: 'Chinese Passport',
      pattern: '\\b[EG]\\d{8}\\b',
      replacement: '[PASSPORT]',
    },
  ],
  dateOfBirth: {
    yearMarker: '年',
    monthMarker: '月',
    dayMarker: '日',
    contextKeywords: ['出生于', '出生日期', '生日', '生于'],
  },
};
