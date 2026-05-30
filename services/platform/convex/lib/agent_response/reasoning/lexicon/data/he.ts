import type { ReasoningLexicon } from '../types';

export const he: ReasoningLexicon = {
  locale: 'he',
  name: 'Hebrew',
  boundaryMode: 'word',
  hardVerbs: [
    'נתח',
    'הוכח',
    'דבג',
    'מטב',
    'תכנן',
    'ממש',
    'השווה',
    'נמק',
    'אלגוריתם',
  ],
  easyVerbs: ['תרגם', 'סכם', 'נסח מחדש', 'שכתב', 'קצר', 'עצב'],
  trivialAcks: ['שלום', 'היי', 'תודה', 'אוקיי', 'כן', 'לא', 'בבקשה'],
  creativeVerbs: ['כתוב', 'סיפור', 'שיר', 'דמיין', 'המצא'],
  analyticalVerbs: ['חשב', 'הוכח', 'דבג', 'חלץ', 'סווג', 'פתור', 'אמת'],
};
