import type { ReasoningLexicon } from '../types';

export const th: ReasoningLexicon = {
  locale: 'th',
  name: 'Thai',
  // Thai is written without spaces between words → substring matching.
  boundaryMode: 'substring',
  hardVerbs: [
    'วิเคราะห์',
    'พิสูจน์',
    'ดีบัก',
    'เพิ่มประสิทธิภาพ',
    'ออกแบบ',
    'นำไปใช้',
    'เปรียบเทียบ',
    'อัลกอริทึม',
  ],
  easyVerbs: ['แปล', 'สรุป', 'เรียบเรียงใหม่', 'เขียนใหม่', 'ย่อ'],
  trivialAcks: ['สวัสดี', 'ขอบคุณ', 'โอเค', 'ใช่', 'ไม่'],
  creativeVerbs: ['เขียน', 'เรื่อง', 'บทกวี', 'จินตนาการ', 'สร้างสรรค์', 'เพลง'],
  analyticalVerbs: ['คำนวณ', 'พิสูจน์', 'ดีบัก', 'แยก', 'จัดประเภท', 'แก้', 'ตรวจสอบ'],
};
