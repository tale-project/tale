import type { ReasoningLexicon } from '../types';

export const fa: ReasoningLexicon = {
  locale: 'fa',
  name: 'Persian',
  boundaryMode: 'word',
  hardVerbs: [
    'تحلیل',
    'اثبات',
    'دیباگ',
    'بهینه',
    'طراحی',
    'پیاده‌سازی',
    'مقایسه',
    'استدلال',
    'الگوریتم',
  ],
  easyVerbs: ['ترجمه', 'خلاصه', 'بازنویسی', 'کوتاه', 'قالب‌بندی'],
  trivialAcks: ['سلام', 'درود', 'ممنون', 'مرسی', 'باشه', 'بله', 'نه', 'لطفا'],
  creativeVerbs: ['بنویس', 'داستان', 'شعر', 'تصور', 'بساز', 'آهنگ'],
  analyticalVerbs: [
    'محاسبه',
    'اثبات',
    'دیباگ',
    'استخراج',
    'دسته‌بندی',
    'حل',
    'بررسی',
  ],
};
