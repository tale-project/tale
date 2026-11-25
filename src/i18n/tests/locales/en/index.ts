/**
 * English locale config. Assembles the per-concern files into a
 * single `LocaleConfig`.
 *
 * Doctrine: `.agents/translation/locales/en/AGENTS.md`.
 */

import type { LocaleConfig } from '../types';
import { GRAMMAR_EN } from './grammar';
import { PATTERNS_EN } from './patterns';
import { STYLE_EN } from './style';
import { TERMINOLOGY_EN } from './terminology';
import { VOICE_EN } from './voice';

export const LOCALE_EN: LocaleConfig = {
  id: 'en',
  displayName: 'English',
  fallback: ['en'],
  regional: false,
  style: STYLE_EN,
  voice: VOICE_EN,
  terminology: TERMINOLOGY_EN,
  grammar: GRAMMAR_EN,
  patterns: PATTERNS_EN,
  doctrine: '.agents/translation/locales/en/AGENTS.md',
};
