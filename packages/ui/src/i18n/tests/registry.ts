/**
 * Check registry. Lists every check the framework ships. Order is the
 * order checks register their tests with vitest (parity + usage first so
 * structural problems surface before content checks).
 *
 * To add a check:
 *   1. Add the file under `checks/`.
 *   2. Append the import + entry below.
 *   3. Add the literal to `CheckId` in `config.ts`.
 *   4. Add a planted fixture under `locales/<locale>/planted/<check-id>/`
 *      (or `__meta__/fixtures/<check-id>/` for locale-agnostic checks).
 */

import { glossaryCoverage } from './checks/glossary-coverage';
import { grammarArticles } from './checks/grammar-articles';
import { icuPlaceholderParity } from './checks/icu-placeholder-parity';
import { icuPluralRules } from './checks/icu-plural-rules';
import { markdownAnchorParity } from './checks/markdown-anchor-parity';
import { markdownLinkTarget } from './checks/markdown-link-target';
import { parity } from './checks/parity';
import { placeholderDensity } from './checks/placeholder-density';
import { pronounsFormal } from './checks/pronouns-formal';
import { proseExclamation } from './checks/prose-exclamation';
import { statusChatter } from './checks/status-chatter';
import { styleApostrophes } from './checks/style-apostrophes';
import { styleCurrency } from './checks/style-currency';
import { styleDates } from './checks/style-dates';
import { styleEmDash } from './checks/style-em-dash';
import { styleEnDash } from './checks/style-en-dash';
import { styleNbsp } from './checks/style-nbsp';
import { styleNumbers } from './checks/style-numbers';
import { stylePercentNbsp } from './checks/style-percent-nbsp';
import { styleQuotes } from './checks/style-quotes';
import { styleSs } from './checks/style-ss';
import { terminologyHalfCompound } from './checks/terminology-half-compound';
import { terminologyLoanword } from './checks/terminology-loanword';
import { terminologyUiLabel } from './checks/terminology-ui-label';
import type { Check } from './checks/types';
import { usage } from './checks/usage';
import { voiceDrift } from './checks/voice-drift';
import { voiceStrikes } from './checks/voice-strikes';

export const CHECKS: ReadonlyArray<Check> = [
  parity,
  usage,
  pronounsFormal,
  terminologyLoanword,
  terminologyHalfCompound,
  terminologyUiLabel,
  voiceStrikes,
  voiceDrift,
  grammarArticles,
  styleQuotes,
  styleApostrophes,
  styleEmDash,
  styleEnDash,
  styleNbsp,
  styleNumbers,
  styleDates,
  stylePercentNbsp,
  styleCurrency,
  styleSs,
  icuPlaceholderParity,
  icuPluralRules,
  glossaryCoverage,
  statusChatter,
  proseExclamation,
  markdownAnchorParity,
  markdownLinkTarget,
  placeholderDensity,
];
