import type { ReasoningLexicon } from '../types';

export const ko: ReasoningLexicon = {
  locale: 'ko',
  name: 'Korean',
  // Korean agglutinates endings onto stems (분석 → 분석해줘), so word boundaries
  // would miss inflected forms; substring-match the distinctive stems.
  boundaryMode: 'substring',
  hardVerbs: [
    '분석',
    '증명',
    '디버그',
    '최적화',
    '설계',
    '구현',
    '비교',
    '추론',
    '알고리즘',
  ],
  easyVerbs: ['번역', '요약', '재구성', '단축', '서식'],
  trivialAcks: [
    '안녕하세요',
    '안녕',
    '감사합니다',
    '고마워',
    '네',
    '아니요',
    '좋아요',
  ],
  creativeVerbs: ['작성', '이야기', '상상', '창작', '노래'],
  analyticalVerbs: ['계산', '증명', '디버그', '추출', '분류', '해결', '검증'],
};
