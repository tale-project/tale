/**
 * French locale config.
 *
 * Doctrine: `.agents/translation/locales/fr/AGENTS.md`.
 */

import type { LocaleConfig } from '../types';
import { GRAMMAR_FR } from './grammar';
import { PATTERNS_FR } from './patterns';
import { STYLE_FR } from './style';
import { TERMINOLOGY_FR } from './terminology';
import { VOICE_FR } from './voice';

export const LOCALE_FR: LocaleConfig = {
  id: 'fr',
  displayName: 'French',
  fallback: ['fr', 'en'],
  regional: false,
  style: STYLE_FR,
  voice: VOICE_FR,
  terminology: TERMINOLOGY_FR,
  grammar: GRAMMAR_FR,
  patterns: PATTERNS_FR,
  doctrine: '.agents/translation/locales/fr/AGENTS.md',
};
