import { describe, expect, it } from 'vitest';

import {
  matchesAnalyticalVerb,
  matchesCreativeVerb,
  matchesEasyVerb,
  matchesHardVerb,
  matchesTrivialAck,
} from './index';

describe('multilingual lexicon', () => {
  it('detects hard/deliberative intent across languages', () => {
    expect(matchesHardVerb('please prove this theorem')).toBe(true); // en
    expect(matchesHardVerb('bitte beweise diesen Satz')).toBe(true); // de
    expect(matchesHardVerb('analyse ce code stp')).toBe(true); // fr
    expect(matchesHardVerb('optimiza esta función por favor')).toBe(true); // es
    expect(matchesHardVerb('докажи это утверждение')).toBe(true); // ru
    expect(matchesHardVerb('请分析这段代码')).toBe(true); // zh-Hans
    expect(matchesHardVerb('このコードをデバッグして')).toBe(true); // ja
  });

  it('detects mechanical/easy intent across languages', () => {
    expect(matchesEasyVerb('translate this to French')).toBe(true);
    expect(matchesEasyVerb('übersetze das ins Englische')).toBe(true);
    expect(matchesEasyVerb('résume ce paragraphe')).toBe(true);
    expect(matchesEasyVerb('请翻译这段话')).toBe(true);
  });

  it('detects trivial acknowledgements as whole messages across languages', () => {
    for (const ack of [
      'hi',
      'thanks!',
      'hallo',
      'merci',
      'gracias',
      'спасибо',
      '你好',
      'ありがとう',
    ]) {
      expect(matchesTrivialAck(ack)).toBe(true);
    }
    // Not trivial when the ack is only a prefix of a real request.
    expect(matchesTrivialAck('hi, can you analyze this dataset?')).toBe(false);
  });

  it('respects Unicode word boundaries for space-separated scripts', () => {
    expect(matchesHardVerb('optimize the hot loop')).toBe(true);
    // `optimize` must not fire inside `optimizer`.
    expect(matchesHardVerb('the optimizer finished quickly')).toBe(false);
  });

  it('separates creative from analytical intent', () => {
    expect(matchesCreativeVerb('write a short story about a robot')).toBe(true);
    expect(matchesAnalyticalVerb('calculate the variance of this sample')).toBe(
      true,
    );
    expect(matchesCreativeVerb('calculate the variance of this sample')).toBe(
      false,
    );
  });
});

describe('lexicon — PII-parity locale coverage', () => {
  it('detects hard intent in additional space-separated scripts', () => {
    expect(matchesHardVerb('حلل هذا الكود')).toBe(true); // ar
    expect(matchesHardVerb('נתח את הקוד הזה')).toBe(true); // he
    expect(matchesHardVerb('इस कोड का विश्लेषण करें')).toBe(true); // hi
    expect(matchesHardVerb('udowodnij to twierdzenie')).toBe(true); // pl
    expect(matchesHardVerb('проаналізуй цей код')).toBe(true); // uk
    expect(matchesHardVerb('phân tích đoạn mã này')).toBe(true); // vi
  });

  it('detects hard intent in space-less scripts via substring matching', () => {
    expect(matchesHardVerb('이 코드를 분석해줘')).toBe(true); // ko (분석 inside)
    expect(matchesHardVerb('ช่วยวิเคราะห์โค้ดนี้หน่อย')).toBe(true); // th
    expect(matchesHardVerb('請分析這段程式碼')).toBe(true); // zh-Hant
  });

  it('detects easy intent and trivial acks across locales', () => {
    expect(matchesEasyVerb('bu metni özetle')).toBe(true); // tr
    expect(matchesEasyVerb('переклади це речення')).toBe(true); // uk
    for (const ack of ['merci', 'gracias', 'спасибо', '안녕', 'สวัสดี', 'سلام']) {
      expect(matchesTrivialAck(ack)).toBe(true);
    }
  });
});
