/**
 * English voice config — marketing-softener denylist.
 *
 * Migrated from `services/docs/tests/data/voice-strike-en.ts`. The skill
 * (`.agents/translation/locales/en/AGENTS.md`) names the category ("words
 * that assert quality the page should demonstrate"); the list below is what
 * the test catches.
 */

import { wordBoundary } from '../../internals/regex';
import type { LocaleVoiceConfig, StrikeEntry } from '../types';

const STRIKES: ReadonlyArray<StrikeEntry> = [
  {
    pattern: wordBoundary('simply', 'gi'),
    rule: 'en-simply',
    suggest: 'delete; the demonstration carries it',
    applyTo: ['json', 'markdown'],
  },
  {
    pattern: wordBoundary('easy', 'gi'),
    rule: 'en-easy',
    suggest: 'delete; if it is easy, the page shows it',
    applyTo: ['json', 'markdown'],
  },
  {
    pattern: wordBoundary('easily', 'gi'),
    rule: 'en-easily',
    suggest: 'delete',
    applyTo: ['json', 'markdown'],
  },
  {
    pattern: wordBoundary('powerful', 'gi'),
    rule: 'en-powerful',
    suggest: 'replace with a concrete capability',
    applyTo: ['json', 'markdown'],
  },
  {
    pattern: wordBoundary('seamless', 'gi'),
    rule: 'en-seamless',
    suggest: 'describe the missing step',
    applyTo: ['json', 'markdown'],
  },
  {
    pattern: wordBoundary('seamlessly', 'gi'),
    rule: 'en-seamlessly',
    suggest: 'delete',
    applyTo: ['json', 'markdown'],
  },
  {
    pattern: wordBoundary('please', 'gi'),
    rule: 'en-please',
    suggest: 'delete; imperative does the work',
    applyTo: ['json', 'markdown'],
  },
  {
    pattern: /\bfeel free to\b/gi,
    rule: 'en-feel-free-to',
    suggest: 'delete; just give the instruction',
    applyTo: ['json', 'markdown'],
  },
  {
    pattern: wordBoundary('discover', 'gi'),
    rule: 'en-discover',
    suggest: 'use "read", "open", or "see"',
    applyTo: ['markdown'],
  },
  {
    pattern: wordBoundary('unleash', 'gi'),
    rule: 'en-unleash',
    suggest: 'replace with the concrete action',
    applyTo: ['markdown'],
  },
  {
    pattern: wordBoundary('effortlessly', 'gi'),
    rule: 'en-effortlessly',
    suggest: 'delete',
    applyTo: ['json', 'markdown'],
  },
  {
    pattern: wordBoundary('straightforward', 'gi'),
    rule: 'en-straightforward',
    suggest: 'delete; the page shows the shape',
    applyTo: ['markdown'],
  },
  {
    pattern: wordBoundary('intuitive', 'gi'),
    rule: 'en-intuitive',
    suggest: 'delete; the screenshot shows it',
    applyTo: ['markdown'],
  },
];

export const VOICE_EN: LocaleVoiceConfig = {
  strikes: STRIKES,
  drift: [], // EN has no named bureaucratic-drift modes today; that's a DE-specific concern.
};
