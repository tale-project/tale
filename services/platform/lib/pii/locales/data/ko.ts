import type { LocaleConfig } from '../types';

export const ko: LocaleConfig = {
  locale: 'ko',
  name: 'Korean',
  scripts: ['kore'],
  countries: ['KR'],
  phoneContextKeywords: ['전화', '휴대폰', '핸드폰', '전화번호', 'tel.', 'tel'],
  cvcContextKeywords: ['보안코드', 'cvc', 'cvv', 'cv2'],
  address: {
    forms: ['postcode-anchored', 'po-box'],
    postcodeForm: 'kr',
    postcodeRegex: '\\d{5}',
    countryNames: ['대한민국', 'Korea', 'South Korea', 'KR'],
    countryPostcodePrefixes: [],
    poBoxKeywords: ['사서함'],
    requireUppercase: false,
  },
  nationalIds: [
    {
      id: 'kr-rrn',
      name: 'Korean Resident Registration Number',
      pattern: '\\b\\d{6}-?[1-4]\\d{6}\\b',
      replacement: '[RRN]',
    },
    {
      id: 'kr-passport',
      name: 'Korean Passport Number',
      pattern: '\\b[MS]\\d{8}\\b',
      replacement: '[PASSPORT]',
    },
  ],
  dateOfBirth: {
    yearMarker: '년',
    monthMarker: '월',
    dayMarker: '일',
    contextKeywords: ['생년월일', '출생', '생일', '태어난'],
  },
};
