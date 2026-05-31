import type { ReasoningLexicon } from '../types';

export const cs: ReasoningLexicon = {
  locale: 'cs',
  name: 'Czech',
  boundaryMode: 'word',
  hardVerbs: [
    'analyzuj',
    'dokaž',
    'debuguj',
    'optimalizuj',
    'navrhni',
    'implementuj',
    'porovnej',
    'zdůvodni',
    'algoritmus',
  ],
  easyVerbs: ['přelož', 'shrň', 'přeformuluj', 'přepiš', 'zkrať', 'naformátuj'],
  trivialAcks: ['ahoj', 'čau', 'díky', 'děkuji', 'ok', 'ano', 'ne', 'prosím'],
  creativeVerbs: [
    'napiš',
    'příběh',
    'báseň',
    'vymysli',
    'vytvoř',
    'píseň',
    'kreativní',
  ],
  analyticalVerbs: [
    'spočítej',
    'dokaž',
    'debuguj',
    'extrahuj',
    'klasifikuj',
    'vyřeš',
    'ověř',
  ],
};
