/**
 * Formal-pronoun denylist per locale.
 *
 * Tale's voice is second-person informal (`du` in DE, `tu` in FR). The
 * formal forms below are rejected by `40-terminology-pronouns.test.ts`.
 *
 * Sentence-initial `Sie` in DE is heuristically allowed because it can be
 * the capitalised third-person plural; the test applies that exception via
 * `isCapitalisedSentenceStart` from `lib/glossary.ts`.
 *
 * Doctrine for why each entry is forbidden lives in
 * `.agents/terminology/TERMINOLOGY_{DE,FR}.md` §1.
 */

export const FORMAL_PRONOUNS: Record<string, readonly string[]> = {
  de: [
    'Sie', // formal subject — also third-person plural; sentence-initial allowed
    'Ihnen', // formal dative
    'Ihre', // formal possessive (fem/pl nom/acc)
    'Ihrer', // formal possessive (gen/dat fem)
    'Ihres', // formal possessive (gen masc/neut)
    'Ihrem', // formal possessive (dat masc/neut)
    'Ihren', // formal possessive (acc masc, dat pl)
  ],
  fr: [
    'vous', // formal subject/object
    'votre', // formal possessive (singular)
    'vos', // formal possessive (plural)
    'Vous',
    'Votre',
    'Vos',
    // `vôtre` / `vôtres` (strong-form possessive pronoun) is rare in docs
    // prose and ambiguous in legal copy — left out deliberately.
  ],
};
