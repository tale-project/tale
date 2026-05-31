import type { ReasoningLexicon } from '../types';

export const ur: ReasoningLexicon = {
  locale: 'ur',
  name: 'Urdu',
  boundaryMode: 'word',
  hardVerbs: [
    'تجزیہ',
    'ثابت',
    'ڈیبگ',
    'بہتر بنائیں',
    'ڈیزائن',
    'نافذ کریں',
    'موازنہ',
    'الگورتھم',
  ],
  easyVerbs: ['ترجمہ', 'خلاصہ', 'دوبارہ لکھیں', 'مختصر'],
  trivialAcks: ['سلام', 'ہیلو', 'شکریہ', 'ٹھیک ہے', 'ہاں', 'نہیں', 'براہ کرم'],
  creativeVerbs: ['لکھیں', 'کہانی', 'نظم', 'تصور', 'تخلیق', 'گانا'],
  analyticalVerbs: [
    'حساب',
    'ثابت',
    'ڈیبگ',
    'نکالیں',
    'درجہ بندی',
    'حل',
    'تصدیق',
  ],
};
