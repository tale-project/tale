import type { StrikeEntry } from '../lib/rules';

/**
 * The French strike list — words that fail review on sight in `docs/fr/**`.
 *
 * Source: `.agents/terminology/TERMINOLOGY_FR.md` §1 strike-on-sight table.
 *
 * Consumed by `52-voice-fr.test.ts`. Boundary is `fr` to handle accented
 * letters (so `découvre` doesn't trip inside `redécouvre`).
 *
 * Capitalised forms are listed explicitly only when the rule cares about
 * capitalisation; lowercase terms with `caseInsensitive: true` (default)
 * catch both forms.
 */

export const VOICE_STRIKE_FR: readonly StrikeEntry[] = [
  {
    id: 'fr-decouvre',
    term: 'Découvre',
    boundary: 'fr',
    caseInsensitive: false,
    replace: 'replace with "Lis", "Ouvre", "Va voir"',
  },
  {
    id: 'fr-decouvrez',
    term: 'Découvrez',
    boundary: 'fr',
    caseInsensitive: false,
    replace: 'replace with "Lis", "Ouvre", "Va voir"',
  },
  {
    id: 'fr-nhesite-pas-a',
    term: "N'hésite pas à",
    boundary: 'fr',
    caseInsensitive: false,
    replace: 'delete; imperative does the work',
  },
  {
    id: 'fr-nhesitez-pas-a',
    term: "N'hésitez pas à",
    boundary: 'fr',
    caseInsensitive: false,
    replace: 'delete; imperative does the work',
  },
  {
    id: 'fr-tout-simplement',
    term: 'tout simplement',
    boundary: 'fr',
    replace: 'delete',
  },
  {
    id: 'fr-il-te-suffit-de',
    term: 'il te suffit de',
    boundary: 'fr',
    replace: 'delete; replace with the imperative',
  },
  {
    id: 'fr-il-vous-suffit-de',
    term: 'il vous suffit de',
    boundary: 'fr',
    replace: 'delete; replace with the imperative',
  },
  {
    id: 'fr-simplement',
    term: 'simplement',
    boundary: 'fr',
    replace: 'delete',
  },
  {
    id: 'fr-facilement',
    term: 'facilement',
    boundary: 'fr',
    replace: 'delete',
  },
  {
    id: 'fr-en-toute-simplicite',
    term: 'en toute simplicité',
    boundary: 'fr',
    replace: 'delete',
  },
  {
    id: 'fr-puissant',
    term: 'puissant',
    boundary: 'fr',
    replace: 'delete or replace with concrete capability',
  },
  {
    id: 'fr-puissante',
    term: 'puissante',
    boundary: 'fr',
    replace: 'delete or replace with concrete capability',
  },
  {
    id: 'fr-cle-en-main',
    term: 'clé en main',
    boundary: 'fr',
    replace: "delete; describe what's pre-configured",
  },
  {
    id: 'fr-profite',
    term: 'Profite',
    boundary: 'fr',
    caseInsensitive: false,
    replace: 'delete; the demonstration carries it',
  },
  {
    id: 'fr-profitez',
    term: 'Profitez',
    boundary: 'fr',
    caseInsensitive: false,
    replace: 'delete',
  },
  {
    id: 'fr-beneficie',
    term: 'Bénéficie',
    boundary: 'fr',
    caseInsensitive: false,
    replace: 'delete',
  },
  {
    id: 'fr-beneficiez',
    term: 'Bénéficiez',
    boundary: 'fr',
    caseInsensitive: false,
    replace: 'delete',
  },
  {
    id: 'fr-stp',
    term: "s'il te plaît",
    boundary: 'fr',
    replace: 'delete; imperative does the work',
  },
  {
    id: 'fr-svp',
    term: "s'il vous plaît",
    boundary: 'fr',
    replace: 'delete; imperative does the work',
  },
];
