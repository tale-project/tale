/**
 * French voice config — marketing-softener strikes.
 *
 * Migrated from `services/docs/tests/data/voice-strike-fr.ts`.
 */

import { wordBoundaryFr } from '../../internals/regex';
import type { LocaleVoiceConfig, StrikeEntry } from '../types';

const STRIKES: ReadonlyArray<StrikeEntry> = [
  {
    pattern: wordBoundaryFr('Découvre', 'g'),
    rule: 'fr-strike-decouvre',
    suggest: 'use "Lis", "Ouvre", "Va voir"',
    applyTo: ['markdown'],
  },
  {
    pattern: wordBoundaryFr('Découvrez', 'g'),
    rule: 'fr-strike-decouvrez',
    suggest: 'use "Lis", "Ouvre", "Va voir"',
    applyTo: ['markdown'],
  },
  {
    pattern: /N['’]hésite pas à/g,
    rule: 'fr-strike-nhesite-pas-a',
    suggest: 'delete; imperative does the work',
    applyTo: ['markdown'],
  },
  {
    pattern: /N['’]hésitez pas à/g,
    rule: 'fr-strike-nhesitez-pas-a',
    suggest: 'delete; imperative does the work',
    applyTo: ['markdown'],
  },
  {
    pattern: /\btout simplement\b/gi,
    rule: 'fr-strike-tout-simplement',
    suggest: 'delete',
    applyTo: ['json', 'markdown'],
  },
  {
    pattern: /\bil te suffit de\b/gi,
    rule: 'fr-strike-il-te-suffit-de',
    suggest: 'replace with the imperative',
    applyTo: ['markdown'],
  },
  {
    pattern: /\bil vous suffit de\b/gi,
    rule: 'fr-strike-il-vous-suffit-de',
    suggest: 'replace with the imperative',
    applyTo: ['markdown'],
  },
  {
    pattern: wordBoundaryFr('simplement', 'gi'),
    rule: 'fr-strike-simplement',
    suggest: 'delete',
    applyTo: ['json', 'markdown'],
  },
  {
    pattern: wordBoundaryFr('facilement', 'gi'),
    rule: 'fr-strike-facilement',
    suggest: 'delete',
    applyTo: ['json', 'markdown'],
  },
  {
    pattern: /\ben toute simplicité\b/gi,
    rule: 'fr-strike-en-toute-simplicite',
    suggest: 'delete',
    applyTo: ['markdown'],
  },
  {
    pattern: wordBoundaryFr('puissant', 'gi'),
    rule: 'fr-strike-puissant',
    suggest: 'replace with concrete capability',
    applyTo: ['markdown'],
  },
  {
    pattern: wordBoundaryFr('puissante', 'gi'),
    rule: 'fr-strike-puissante',
    suggest: 'replace with concrete capability',
    applyTo: ['markdown'],
  },
  {
    pattern: /\bclé en main\b/gi,
    rule: 'fr-strike-cle-en-main',
    suggest: 'describe what is pre-configured',
    applyTo: ['markdown'],
  },
  {
    pattern: wordBoundaryFr('Profite', 'g'),
    rule: 'fr-strike-profite',
    suggest: 'delete; demonstration carries it',
    applyTo: ['markdown'],
  },
  {
    pattern: wordBoundaryFr('Profitez', 'g'),
    rule: 'fr-strike-profitez',
    suggest: 'delete',
    applyTo: ['markdown'],
  },
  {
    pattern: wordBoundaryFr('Bénéficie', 'g'),
    rule: 'fr-strike-beneficie',
    suggest: 'delete',
    applyTo: ['markdown'],
  },
  {
    pattern: wordBoundaryFr('Bénéficiez', 'g'),
    rule: 'fr-strike-beneficiez',
    suggest: 'delete',
    applyTo: ['markdown'],
  },
  {
    pattern: /s['’]il te pla[iî]t/gi,
    rule: 'fr-strike-stp',
    suggest: 'delete; imperative does the work',
    applyTo: ['markdown'],
  },
  {
    pattern: /s['’]il vous pla[iî]t/gi,
    rule: 'fr-strike-svp',
    suggest: 'delete; imperative does the work',
    applyTo: ['markdown'],
  },
];

export const VOICE_FR: LocaleVoiceConfig = {
  strikes: STRIKES,
  drift: [], // FR drift modes are marketing softeners (in strikes) + nominal stacking (reviewer-caught).
};
