import type { ReasoningLexicon } from '../types';

export const tl: ReasoningLexicon = {
  locale: 'tl',
  name: 'Tagalog',
  boundaryMode: 'word',
  hardVerbs: [
    'suriin',
    'patunayan',
    'i-debug',
    'i-optimize',
    'magdisenyo',
    'ipatupad',
    'ihambing',
    'mangatwiran',
    'algoritmo',
  ],
  easyVerbs: [
    'isalin',
    'ibuod',
    'i-rephrase',
    'muling isulat',
    'paikliin',
    'i-format',
  ],
  trivialAcks: ['kumusta', 'hi', 'salamat', 'ok', 'oo', 'hindi', 'pakiusap'],
  creativeVerbs: ['sumulat', 'kuwento', 'tula', 'isipin', 'lumikha', 'kanta'],
  analyticalVerbs: [
    'kalkulahin',
    'patunayan',
    'i-debug',
    'kunin',
    'iuri',
    'lutasin',
    'tiyakin',
  ],
};
