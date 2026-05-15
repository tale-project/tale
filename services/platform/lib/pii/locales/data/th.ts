import type { LocaleConfig } from '../types';

export const th: LocaleConfig = {
  locale: 'th',
  name: 'Thai',
  scripts: ['thai'],
  countries: ['TH'],
  phoneContextKeywords: ['โทรศัพท์', 'มือถือ', 'เบอร์', 'tel.', 'tel'],
  cvcContextKeywords: ['รหัสความปลอดภัย', 'cvc', 'cvv', 'cv2'],
  address: {
    forms: ['postcode-anchored', 'po-box'],
    postcodeForm: 'continental',
    postcodeRegex: '\\d{5}',
    countryNames: ['ประเทศไทย', 'Thailand', 'TH'],
    countryPostcodePrefixes: [],
    poBoxKeywords: ['ตู้ ปณ.', 'ตู้ ปณ', 'ตู้ปณ.'],
    requireUppercase: false,
  },
  nationalIds: [
    {
      id: 'th-national-id',
      name: 'Thai National ID',
      pattern: '\\b\\d-\\d{4}-\\d{5}-\\d{2}-\\d\\b',
      replacement: '[TH_ID]',
    },
  ],
  dateOfBirth: {
    monthsLong: [
      'มกราคม',
      'กุมภาพันธ์',
      'มีนาคม',
      'เมษายน',
      'พฤษภาคม',
      'มิถุนายน',
      'กรกฎาคม',
      'สิงหาคม',
      'กันยายน',
      'ตุลาคม',
      'พฤศจิกายน',
      'ธันวาคม',
    ],
    contextKeywords: ['วันเกิด', 'เกิดวันที่', 'เกิด'],
  },
};
