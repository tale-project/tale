import { describe, expect, it } from 'vitest';

import { agentLanguageGuidance } from './agent-language';

describe('agent task language policy', () => {
  it('preserves the canonical task language ahead of the org default and viewer locale', () => {
    const guidance = agentLanguageGuidance({
      defaultLocale: 'fr',
      task: {
        id: 'task-1',
        title: 'Unterlagen prüfen',
        description: 'Bitte die Belege abgleichen.',
      },
    });
    expect(guidance).toContain('French (fr)');
    expect(guidance).toContain(
      'language established by the task title and description',
    );
    expect(guidance).toContain('Unterlagen prüfen');
    expect(guidance).toContain('Bitte die Belege abgleichen.');
    expect(guidance).toContain('including ask_human');
    expect(guidance).toContain(
      'Before updating a different task, read it and preserve its own language',
    );
    expect(guidance).toContain('interface locale of the reader or run starter');
    expect(guidance).toContain(
      'earlier agent replies do not change the task language',
    );
  });

  it('uses the org default for neutral subjects and keeps translated UI output separate', () => {
    const guidance = agentLanguageGuidance({
      defaultLocale: 'de',
      task: { id: 'task-1', title: '2026 Q1', description: null },
    });
    expect(guidance).toContain('default agent language is German (de)');
    expect(guidance).toContain(
      'If there is no clear task language, use German',
    );
    expect(guidance).toContain('"2026 Q1" does not establish a language');
    expect(guidance).toContain('bodyByLocale');
    expect(guidance).toContain('Follow any structured output schema exactly');
  });

  it('gives unbound task creation the organization default', () => {
    expect(
      agentLanguageGuidance({ defaultLocale: 'en', task: null }),
    ).toContain('No task is bound to this run; use the default agent language');
  });

  it('identifies generated title boilerplate without treating its language as the task language', () => {
    const guidance = agentLanguageGuidance({
      defaultLocale: 'de',
      task: {
        id: 'task-1',
        title: 'Quarterly check 2026 Q1',
        description: null,
      },
      taskTitleTemplate: 'Quarterly check {name}',
    });
    expect(guidance).toContain('"Quarterly check {name}"');
    expect(guidance).toContain('fixed words are generated boilerplate');
    expect(guidance).toContain(
      'use the default agent language unless the task description establishes another language',
    );
    expect(guidance).toContain('machine-generated feedback relay headers');
  });
});
