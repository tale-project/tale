/**
 * German locale config.
 *
 * Doctrine: `.agents/translation/locales/de/AGENTS.md`.
 */

import type { LocaleConfig } from '../types';
import { GRAMMAR_DE } from './grammar';
import { PATTERNS_DE } from './patterns';
import { STYLE_DE } from './style';
import { TERMINOLOGY_DE } from './terminology';
import { VOICE_DE } from './voice';

export const LOCALE_DE: LocaleConfig = {
  id: 'de',
  displayName: 'German',
  fallback: ['de', 'en'],
  regional: false,
  style: STYLE_DE,
  voice: VOICE_DE,
  terminology: TERMINOLOGY_DE,
  grammar: GRAMMAR_DE,
  patterns: PATTERNS_DE,
  doctrine: '.agents/translation/locales/de/AGENTS.md',
};
