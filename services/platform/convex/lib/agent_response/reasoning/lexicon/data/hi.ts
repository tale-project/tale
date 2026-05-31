import type { ReasoningLexicon } from '../types';

export const hi: ReasoningLexicon = {
  locale: 'hi',
  name: 'Hindi',
  boundaryMode: 'word',
  hardVerbs: [
    'विश्लेषण',
    'सिद्ध',
    'डिबग',
    'अनुकूलित',
    'डिज़ाइन',
    'कार्यान्वयन',
    'तुलना',
    'तर्क',
    'एल्गोरिदम',
  ],
  easyVerbs: ['अनुवाद', 'सारांश', 'पुनर्लेखन', 'संक्षिप्त', 'प्रारूपित'],
  trivialAcks: ['नमस्ते', 'हाय', 'धन्यवाद', 'ठीक है', 'हाँ', 'नहीं', 'कृपया'],
  creativeVerbs: ['लिखो', 'कहानी', 'कविता', 'कल्पना', 'रचना', 'गाना'],
  analyticalVerbs: ['गणना', 'सिद्ध', 'डिबग', 'निकालें', 'वर्गीकृत', 'हल', 'सत्यापित'],
};
