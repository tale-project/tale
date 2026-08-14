import { describe, expect, it } from 'vitest';

import { assessPromptBand } from './model-band';

describe('assessPromptBand — trivial and empty messages', () => {
  it.each([
    'Thanks!',
    'thank you',
    'ok',
    'Got it.',
    'passt',
    'Vielen Dank',
    'merci beaucoup',
    "d'accord",
    '👍',
    '谢谢',
  ])('classifies %j as draft', (text) => {
    expect(assessPromptBand(text)).toEqual({
      band: 'draft',
      highStakes: false,
      documentWork: false,
    });
  });

  it('classifies empty and whitespace-only text as draft', () => {
    expect(assessPromptBand('').band).toBe('draft');
    expect(assessPromptBand('   \n ').band).toBe('draft');
  });

  it('does not treat an ack PREFIX as trivial', () => {
    // Whole-message matching: gratitude followed by real work is real work.
    const result = assessPromptBand(
      'Thanks! Now prove the algorithm terminates and analyze its complexity.',
    );
    expect(result.band).not.toBe('draft');
  });
});

describe('assessPromptBand — difficulty signals', () => {
  it('keeps a short factual question on draft', () => {
    expect(assessPromptBand('Why is the sky blue?').band).toBe('draft');
  });

  it('lifts a hard work verb to standard', () => {
    expect(
      assessPromptBand('Refactor this function so the cache stays warm.').band,
    ).toBe('standard');
    expect(assessPromptBand('Bitte optimiere diese Abfrage.').band).toBe(
      'standard',
    );
    expect(assessPromptBand('Peux-tu analyser cette architecture ?').band).toBe(
      'standard',
    );
  });

  it('does not fire a work verb inside a longer word', () => {
    // "optimize" must not match inside "optimizer".
    expect(assessPromptBand('What is a query optimizer?').band).toBe('draft');
  });

  it('reaches frontier when a code artifact meets a hard verb', () => {
    const prompt = [
      'Debug this — the retry loop never exits:',
      '```ts',
      'while (true) { await retry(); }',
      '```',
    ].join('\n');
    expect(assessPromptBand(prompt).band).toBe('frontier');
  });

  it('recognizes a pasted stack trace as a code artifact', () => {
    const prompt = [
      'Analyze why this happens:',
      'TypeError: x is not a function',
      '    at handle (src/server.ts:42:11)',
      '    at run (src/index.ts:7:3)',
    ].join('\n');
    expect(assessPromptBand(prompt).band).toBe('frontier');
  });

  it('pulls mechanical asks down to draft', () => {
    expect(
      assessPromptBand(
        'Translate this paragraph to French: the meeting moved to Tuesday.',
      ).band,
    ).toBe('draft');
    expect(
      assessPromptBand('Fasse diesen Text bitte kurz zusammen: alles gut.')
        .band,
    ).toBe('draft');
  });

  it('lets a hard verb outrank a mechanical one in the same prompt', () => {
    expect(
      assessPromptBand(
        'Summarize the findings, then prove the bound still holds.',
      ).band,
    ).toBe('standard');
  });

  it('counts length, math, and staged steps toward the score', () => {
    const long = `Compare these approaches. ${'The workload details matter here. '.repeat(80)}`;
    expect(assessPromptBand(long).band).toBe('frontier'); // verb +2, length +2

    expect(
      assessPromptBand(
        'Derive the closed form: \\sum_{i=1}^{n} i^2 and prove it.',
      ).band,
    ).toBe('standard'); // hard verbs +2, math +1

    const steps = [
      'Design the rollout:',
      '1. freeze writes',
      '2. copy the table',
      '3. flip the reads',
    ].join('\n');
    expect(assessPromptBand(steps).band).toBe('standard'); // verb +2, steps +1
  });
});

describe('assessPromptBand — high-stakes ground', () => {
  it.each([
    'What is the right ibuprofen dosage for a child?',
    'Do I need an attorney to answer this lawsuit?',
    'Is this mortgage rate worth refinancing for?',
    'Welche Nebenwirkungen hat dieses Medikament?',
    'Brauche ich für die Steuererklärung einen Anwalt?',
    'Quelle est la posologie recommandée ?',
    "J'ai besoin d'un conseil juridique sur ce contrat.",
  ])('forces frontier for %j', (text) => {
    expect(assessPromptBand(text)).toEqual({
      band: 'frontier',
      highStakes: true,
      documentWork: false,
    });
  });

  it('outranks every downgrade signal', () => {
    // Short + mechanical verb, but medical: still frontier.
    expect(assessPromptBand('Summarize the symptoms list.')).toEqual({
      band: 'frontier',
      highStakes: true,
      documentWork: false,
    });
  });
});

describe('assessPromptBand — document attachments', () => {
  const withDocs = { documentAttachments: true } as const;

  it('floors a short factual ask to standard', () => {
    expect(
      assessPromptBand('Fasse mir das Dokument zusammen', withDocs),
    ).toEqual({
      band: 'standard',
      highStakes: false,
      documentWork: true,
    });
  });

  it('floors a bare file send and a trivial greeting', () => {
    // No typed text (or a mere ack) alongside a document is still document
    // work — the early returns must not skip the floor.
    expect(assessPromptBand('', withDocs).band).toBe('standard');
    expect(assessPromptBand('danke', withDocs).band).toBe('standard');
  });

  it('outranks the light-work discount', () => {
    expect(assessPromptBand('Zusammenfassung bitte.', withDocs).band).toBe(
      'standard',
    );
  });

  it('never lowers a band the text already earned', () => {
    const prompt = [
      'Debug this — the retry loop never exits:',
      '```ts',
      'while (true) { await retry(); }',
      '```',
    ].join('\n');
    expect(assessPromptBand(prompt, withDocs).band).toBe('frontier');
  });

  it('keeps high-stakes frontier and reports both reasons', () => {
    expect(assessPromptBand('Summarize the symptoms list.', withDocs)).toEqual({
      band: 'frontier',
      highStakes: true,
      documentWork: true,
    });
  });

  it('changes nothing when the flag is absent or false', () => {
    expect(assessPromptBand('Why is the sky blue?').documentWork).toBe(false);
    expect(
      assessPromptBand('Why is the sky blue?', { documentAttachments: false })
        .band,
    ).toBe('draft');
  });
});

describe('assessPromptBand — totality', () => {
  it('handles a very large paste without throwing', () => {
    const huge = 'const x = 1;\n'.repeat(20_000);
    expect(assessPromptBand(huge).band).toBe('standard'); // length + code, no verb
  });

  it('handles CJK prose', () => {
    expect(
      assessPromptBand('请分析一下这个架构的优缺点,并给出迁移方案。').band,
    ).toBe(
      'draft', // no en/de/fr signal fires; degrades one band, never throws
    );
  });
});
