import type { ReasoningLexicon } from '../types';

export const lt: ReasoningLexicon = {
  locale: 'lt',
  name: 'Lithuanian',
  boundaryMode: 'word',
  hardVerbs: [
    'analizuok',
    'įrodyk',
    'derink',
    'optimizuok',
    'suprojektuok',
    'įgyvendink',
    'palygink',
    'samprotauk',
    'algoritmas',
  ],
  easyVerbs: [
    'išversk',
    'apibendrink',
    'perfrazuok',
    'perrašyk',
    'sutrumpink',
    'formatuok',
  ],
  trivialAcks: ['labas', 'sveiki', 'ačiū', 'gerai', 'taip', 'ne', 'prašau'],
  creativeVerbs: [
    'parašyk',
    'istorija',
    'eilėraštis',
    'įsivaizduok',
    'sukurk',
    'daina',
  ],
  analyticalVerbs: [
    'apskaičiuok',
    'įrodyk',
    'ištrauk',
    'klasifikuok',
    'išspręsk',
    'patikrink',
  ],
};
