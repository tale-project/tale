import type { ReasoningLexicon } from '../types';

export const vi: ReasoningLexicon = {
  locale: 'vi',
  name: 'Vietnamese',
  boundaryMode: 'word',
  hardVerbs: [
    'phân tích',
    'chứng minh',
    'gỡ lỗi',
    'tối ưu',
    'thiết kế',
    'triển khai',
    'so sánh',
    'thuật toán',
  ],
  easyVerbs: [
    'dịch',
    'tóm tắt',
    'diễn đạt lại',
    'viết lại',
    'rút ngắn',
    'định dạng',
  ],
  trivialAcks: ['chào', 'xin chào', 'cảm ơn', 'ok', 'vâng', 'không', 'làm ơn'],
  creativeVerbs: [
    'viết',
    'câu chuyện',
    'bài thơ',
    'tưởng tượng',
    'sáng tạo',
    'bài hát',
  ],
  analyticalVerbs: [
    'tính',
    'chứng minh',
    'gỡ lỗi',
    'trích xuất',
    'phân loại',
    'giải',
    'xác minh',
  ],
};
