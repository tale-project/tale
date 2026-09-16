/**
 * Swiss German locale config — sparse overlay on top of DE.
 *
 * Voice, terminology, and grammar inherit from DE (a Swiss reader hears
 * the same German narrator with Swiss spelling/typography). Style and
 * patterns are overridden.
 *
 * Doctrine: `.agents/translation/locales/de-CH/AGENTS.md`.
 */

import { GRAMMAR_DE } from '../de/grammar';
import { PATTERNS_DE } from '../de/patterns';
import { TERMINOLOGY_DE } from '../de/terminology';
import { VOICE_DE } from '../de/voice';
import type { LocaleConfig } from '../types';
import { STYLE_DE_CH } from './style';

export const LOCALE_DE_CH: LocaleConfig = {
  id: 'de-CH',
  displayName: 'Swiss German',
  fallback: ['de-CH', 'de', 'en'],
  regional: true,
  style: STYLE_DE_CH,
  voice: VOICE_DE,
  terminology: TERMINOLOGY_DE,
  grammar: GRAMMAR_DE,
  patterns: PATTERNS_DE,
  doctrine: '.agents/translation/locales/de-CH/AGENTS.md',
};
