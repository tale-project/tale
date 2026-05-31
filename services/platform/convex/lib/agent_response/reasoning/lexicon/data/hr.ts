import type { ReasoningLexicon } from '../types';

export const hr: ReasoningLexicon = {
  locale: 'hr',
  name: 'Croatian',
  boundaryMode: 'word',
  hardVerbs: [
    'analiziraj',
    'dokaži',
    'optimiziraj',
    'dizajniraj',
    'implementiraj',
    'usporedi',
    'obrazloži',
    'algoritam',
  ],
  easyVerbs: [
    'prevedi',
    'sažmi',
    'preoblikuj',
    'prepiši',
    'skrati',
    'formatiraj',
  ],
  trivialAcks: ['bok', 'pozdrav', 'hvala', 'ok', 'da', 'ne', 'molim'],
  creativeVerbs: ['napiši', 'priča', 'pjesma', 'zamisli', 'izmisli', 'stvori'],
  analyticalVerbs: [
    'izračunaj',
    'dokaži',
    'izvuci',
    'klasificiraj',
    'riješi',
    'provjeri',
  ],
};
