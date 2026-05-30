import type { ReasoningLexicon } from '../types';

export const et: ReasoningLexicon = {
  locale: 'et',
  name: 'Estonian',
  boundaryMode: 'word',
  hardVerbs: [
    'analüüsi',
    'tõesta',
    'silu',
    'optimeeri',
    'kavanda',
    'teosta',
    'võrdle',
    'põhjenda',
    'algoritm',
  ],
  easyVerbs: [
    'tõlgi',
    'võta kokku',
    'sõnasta ümber',
    'kirjuta ümber',
    'lühenda',
    'vorminda',
  ],
  trivialAcks: ['tere', 'tervist', 'aitäh', 'ok', 'jah', 'ei', 'palun'],
  creativeVerbs: ['kirjuta', 'lugu', 'luuletus', 'kujutle', 'leiuta', 'laul'],
  analyticalVerbs: [
    'arvuta',
    'tõesta',
    'silu',
    'ekstrakti',
    'liigita',
    'lahenda',
    'kontrolli',
  ],
};
