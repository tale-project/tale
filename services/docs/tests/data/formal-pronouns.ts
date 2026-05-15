/**
 * Formal-pronoun denylist per locale.
 *
 * Tale's voice is second-person informal (`du` in DE, `tu` in FR). The
 * formal forms below are rejected by `services/docs/tests/terminology.test.ts`.
 * Sentence-initial `Sie` in DE is heuristically allowed because it can be the
 * capitalised third-person plural `sie`; the test applies that exception.
 *
 * Doctrine for why each entry is forbidden lives in
 * `.agents/terminology/TERMINOLOGY.md` §1 and the per-locale
 * `TERMINOLOGY_<LOCALE>.md` files.
 */
export const FORMAL_PRONOUNS: Record<string, string[]> = {
  de: ['Sie', 'Ihnen', 'Ihre', 'Ihrer', 'Ihres', 'Ihrem'],
  fr: ['vous', 'votre', 'vos', 'Vous', 'Votre', 'Vos'],
};
