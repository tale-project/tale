import type { ReasoningLexicon } from '../types';

export const lv: ReasoningLexicon = {
  locale: 'lv',
  name: 'Latvian',
  boundaryMode: 'word',
  hardVerbs: [
    'analizē',
    'pierādi',
    'atkļūdo',
    'optimizē',
    'izstrādā',
    'ieviesi',
    'salīdzini',
    'spried',
    'algoritms',
  ],
  easyVerbs: [
    'tulko',
    'apkopo',
    'pārformulē',
    'pārraksti',
    'saīsini',
    'formatē',
  ],
  trivialAcks: ['sveiki', 'čau', 'paldies', 'labi', 'jā', 'nē', 'lūdzu'],
  creativeVerbs: [
    'uzraksti',
    'stāsts',
    'dzejolis',
    'iztēlojies',
    'izdomā',
    'dziesma',
  ],
  analyticalVerbs: [
    'aprēķini',
    'pierādi',
    'atkļūdo',
    'izvelc',
    'klasificē',
    'atrisini',
    'pārbaudi',
  ],
};
