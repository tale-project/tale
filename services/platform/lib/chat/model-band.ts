/**
 * Prompt → capability band, for the chat Auto pick.
 *
 * When the composer is on Auto, the server chooses a concrete model per
 * message. The choice is a two-step: this module reads ONLY the message text
 * and names the band a reply deserves — `draft` (acknowledgements, small
 * factual questions), `standard` (everyday work), `frontier` (hard reasoning
 * or high-stakes ground) — and `model-choice.ts` turns the band into a
 * concrete catalog entry. No LLM call, no network: a short, legible signal
 * scan whose every rule is unit-tested, so a surprising route is always
 * explainable from this file.
 *
 * Two deliberate biases:
 *
 *  - **Misses degrade softly.** A missed signal lands one band lower, where
 *    the curated picks are still competent general models — never a broken
 *    turn. So the signal lists stay SHORT and high-precision instead of
 *    chasing recall with the multi-hundred-KB generated lexicons the 0.3
 *    router carried (deleted with the AI-backend rewrite, and not missed:
 *    with catalog tiers gone, their output drove nothing).
 *  - **High-stakes ground forces `frontier`.** Legal, medical, and financial
 *    questions get the strongest band regardless of how short the prompt is.
 *    A false positive merely upgrades one reply; the keyword lists (en/de/fr,
 *    the languages Tale ships) are kept narrow so that stays rare.
 *
 * Pure by design — no Convex, no Node, no locale plumbing — the text itself
 * is the only input.
 */

import {
  buildAnywhereMatcher,
  buildWholeMessageMatcher,
} from '../shared/text-matching';
import { estimateTokens } from './types';

/** Capability bands, weakest first. */
export const MODEL_BANDS = ['draft', 'standard', 'frontier'] as const;
export type ModelBand = (typeof MODEL_BANDS)[number];

export interface PromptBandAssessment {
  band: ModelBand;
  /** Legal / medical / financial ground — the reason `band` is `frontier`
   * even for a one-line prompt, and worth logging as itself. */
  highStakes: boolean;
}

/** The whole message is a greeting or an acknowledgement — nothing to think
 * about, so the weakest band answers it. Whole-message on purpose: "thanks,
 * now prove it" must not match. */
const TRIVIAL_MESSAGE = buildWholeMessageMatcher({
  wordTerms: [
    // en
    'thanks',
    'thank you',
    'thx',
    'ok',
    'okay',
    'got it',
    'sounds good',
    'great',
    'cool',
    'nice',
    'perfect',
    'yes',
    'no',
    'hi',
    'hello',
    'hey',
    'bye',
    'good morning',
    'good night',
    // de
    'danke',
    'vielen dank',
    'alles klar',
    'passt',
    'super',
    'perfekt',
    'ja',
    'nein',
    'hallo',
    'servus',
    'moin',
    'tschüss',
    'guten morgen',
    // fr
    'merci',
    'merci beaucoup',
    "d'accord",
    'parfait',
    'oui',
    'non',
    'salut',
    'bonjour',
    'bonsoir',
    'à bientôt',
  ],
  substringTerms: ['👍', '🙏', '谢谢', '好的', '收到'],
});

/** Work verbs that mark a prompt as genuinely hard: open-ended construction
 * or analysis, not lookup. Matched anywhere, word-bounded. */
const HARD_WORK = buildAnywhereMatcher({
  wordTerms: [
    // en
    'analyze',
    'analyse',
    'architect',
    'debug',
    'derive',
    'design',
    'evaluate',
    'implement',
    'optimize',
    'optimise',
    'prove',
    'refactor',
    'benchmark',
    'root cause',
    'trade-off',
    'tradeoffs',
    'migrate',
    'audit',
    'compare',
    // de
    'analysiere',
    'entwirf',
    'beweise',
    'optimiere',
    'implementiere',
    'refaktoriere',
    'bewerte',
    'begründe',
    'ursache',
    'abwägung',
    'migriere',
    'vergleiche',
    // fr
    'analyser',
    'concevoir',
    'prouver',
    'optimiser',
    'implémenter',
    'démontrer',
    'évaluer',
    'justifier',
    'arbitrage',
    'migrer',
    'comparer',
  ],
  substringTerms: [],
  flags: 'giu',
});

/** Mechanical asks a small model does well; they pull DOWN one step, and only
 * when no hard-work verb appears in the same prompt. */
const LIGHT_WORK = buildAnywhereMatcher({
  wordTerms: [
    // en
    'translate',
    'summarize',
    'summarise',
    'rephrase',
    'reword',
    'shorten',
    'rename',
    'typo',
    'bullet points',
    // de
    'übersetze',
    'fasse zusammen',
    'zusammenfassung',
    'umformulieren',
    'kürze',
    'tippfehler',
    'stichpunkte',
    // fr
    'traduire',
    'traduis',
    'résume',
    'résumer',
    'reformule',
    'reformuler',
    'raccourcis',
    'faute de frappe',
  ],
  substringTerms: [],
  flags: 'giu',
});

/** High-stakes ground: the answer's cost of being wrong is not ours to
 * discount, so the strongest band is forced. Narrow on purpose — see the
 * header. */
const HIGH_STAKES = buildAnywhereMatcher({
  wordTerms: [
    // legal — en / de / fr
    'legal advice',
    'attorney',
    'lawsuit',
    'liability',
    'gdpr',
    'rechtsberatung',
    'anwalt',
    'klage',
    'haftung',
    'dsgvo',
    'abmahnung',
    'avocat',
    'poursuite judiciaire',
    'responsabilité civile',
    'rgpd',
    'conseil juridique',
    // medical — en / de / fr
    'diagnosis',
    'symptom',
    'symptoms',
    'medication',
    'dosage',
    'prescription',
    'side effects',
    'diagnose',
    'symptome',
    'medikament',
    'dosierung',
    'nebenwirkungen',
    'rezeptpflichtig',
    'diagnostic',
    'symptôme',
    'symptômes',
    'médicament',
    'posologie',
    'ordonnance',
    'effets secondaires',
    // financial — en / de / fr
    'investment advice',
    'tax return',
    'mortgage',
    'retirement savings',
    'steuererklärung',
    'hypothek',
    'geldanlage',
    'altersvorsorge',
    'déclaration de revenus',
    'hypothèque',
    'placement financier',
    'épargne retraite',
  ],
  substringTerms: [],
});

/** Fenced code, a pasted stack trace, or an exception header — the message
 * carries an artifact to reason over, not just prose. */
const CODE_ARTIFACT =
  /```|(?:^|\n)\s+at .+\(.+:\d+:\d+\)|Traceback \(most recent call last\)|^\s*(?:[A-Za-z_$][\w$]*\.)*[A-Z][\w$]*(?:Error|Exception)(?::|\b.*^\s+at )/mu;

/** Inline code mentions (`likeThis`) — weaker than a fence. */
const INLINE_CODE = /`[^`\n]+`/gu;

/** Math beyond arithmetic mentions: LaTeX commands or an explicit equation. */
const MATH =
  /\\(?:frac|sum|int|sqrt|begin\{)|[=<>≤≥]\s*[-\d(]|\b\d+\s*[*/^]\s*\d+/u;

/** The prompt itself is staged in steps — numbered lines or step language. */
const MULTI_STEP = buildAnywhereMatcher({
  wordTerms: [
    'step by step',
    'schritt für schritt',
    'étape par étape',
    'first',
    'zuerst',
    "d'abord",
  ],
  substringTerms: [],
});
const NUMBERED_LINES = /(?:^|\n)\s*\d+[.)]\s+\S/gu;

const FRONTIER_THRESHOLD = 4;
const STANDARD_THRESHOLD = 1;

/**
 * Read the band one message deserves. Deterministic and total: any text —
 * empty, emoji, CJK, a 200 KB paste — yields a band without throwing.
 */
export function assessPromptBand(promptText: string): PromptBandAssessment {
  const text = promptText.trim();
  const highStakes = HIGH_STAKES.test(text);
  if (highStakes) return { band: 'frontier', highStakes };
  if (text.length === 0 || TRIVIAL_MESSAGE.test(text)) {
    return { band: 'draft', highStakes: false };
  }

  const tokens = estimateTokens(text);
  let score = 0;
  if (tokens > 600) score += 2;
  else if (tokens > 200) score += 1;
  if (CODE_ARTIFACT.test(text)) score += 2;
  else if ((text.match(INLINE_CODE)?.length ?? 0) >= 2) score += 1;
  if (MATH.test(text)) score += 1;
  if (MULTI_STEP.test(text) || (text.match(NUMBERED_LINES)?.length ?? 0) >= 3) {
    score += 1;
  }

  HARD_WORK.lastIndex = 0;
  LIGHT_WORK.lastIndex = 0;
  const hardHits = text.match(HARD_WORK)?.length ?? 0;
  const lightHits = text.match(LIGHT_WORK)?.length ?? 0;
  if (hardHits > 0) score += 2;
  else if (lightHits > 0) score -= 2;

  const band: ModelBand =
    score >= FRONTIER_THRESHOLD
      ? 'frontier'
      : score >= STANDARD_THRESHOLD
        ? 'standard'
        : 'draft';
  return { band, highStakes: false };
}
