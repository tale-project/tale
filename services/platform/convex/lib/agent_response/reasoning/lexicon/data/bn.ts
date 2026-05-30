import type { ReasoningLexicon } from '../types';

export const bn: ReasoningLexicon = {
  locale: 'bn',
  name: 'Bengali',
  boundaryMode: 'word',
  hardVerbs: [
    'বিশ্লেষণ',
    'প্রমাণ',
    'ডিবাগ',
    'অপ্টিমাইজ',
    'ডিজাইন',
    'বাস্তবায়ন',
    'তুলনা',
    'অ্যালগরিদম',
  ],
  easyVerbs: ['অনুবাদ', 'সারাংশ', 'পুনর্লিখন', 'সংক্ষিপ্ত'],
  trivialAcks: ['হ্যালো', 'হাই', 'ধন্যবাদ', 'ঠিক আছে', 'হ্যাঁ', 'না'],
  creativeVerbs: ['লিখুন', 'গল্প', 'কবিতা', 'কল্পনা', 'গান'],
  analyticalVerbs: ['গণনা', 'প্রমাণ', 'ডিবাগ', 'নিষ্কাশন', 'শ্রেণীবদ্ধ', 'সমাধান'],
};
