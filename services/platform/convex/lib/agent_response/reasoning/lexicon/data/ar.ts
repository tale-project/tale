import type { ReasoningLexicon } from '../types';

export const ar: ReasoningLexicon = {
  locale: 'ar',
  name: 'Arabic',
  boundaryMode: 'word',
  hardVerbs: [
    'حلل',
    'برهن',
    'أثبت',
    'صحح',
    'حسّن',
    'صمم',
    'نفذ',
    'قارن',
    'استنتج',
    'خوارزمية',
  ],
  easyVerbs: ['ترجم', 'لخص', 'أعد صياغة', 'أعد كتابة', 'اختصر', 'نسّق'],
  trivialAcks: ['مرحبا', 'أهلا', 'شكرا', 'حسنا', 'نعم', 'لا', 'من فضلك', 'تمام'],
  creativeVerbs: ['اكتب', 'قصة', 'قصيدة', 'تخيل', 'ابتكر', 'أغنية'],
  analyticalVerbs: ['احسب', 'برهن', 'صحح', 'استخرج', 'صنّف', 'حل', 'تحقق'],
};
