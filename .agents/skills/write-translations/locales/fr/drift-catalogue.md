# FR — drift catalogue

Named marketing-drift patterns. Regex forms in [`packages/ui/src/i18n/tests/locales/fr/voice.ts`](../../../../../packages/ui/src/i18n/tests/locales/fr/voice.ts). Reviewers cover the rest.

## 1. Marketing softeners

**Pattern.** Closed list of words that assert quality the page should demonstrate.

**Examples.** `Découvre`, `Découvrez`, `N'hésite pas à`, `N'hésitez pas à`, `tout simplement`, `il te suffit de`, `il vous suffit de`, `simplement`, `facilement`, `en toute simplicité`, `puissant`, `puissante`, `clé en main`, `Profite de`, `Profitez de`, `Bénéficie de`, `Bénéficiez de`, `s'il te plaît`, `s'il vous plaît`.

**Target.** Strike. Demonstrate the quality instead. Caught by `voice-strikes`.

## 2. Stacked nominal phrases

**Pattern.** Three or more nominal phrases chained by `de`.

**Example drift.** _Une solution clé en main pour la gestion documentaire intégrée multilingue._

**Target.** Relative clause: _Une solution qui gère les documents dans plusieurs langues._

**Why.** French prose prefers relative clauses (`qui`, `que`) over stacked nominal phrases for readability. Stacked phrases mark translation from a noun-heavy English source.

**Not regex-enforced** — reviewers catch.

## 3. Vous-slips

**Pattern.** `vous`, `votre`, `vos` (and their capitalised forms) mid-sentence.

**Target.** `tu`, `ton`/`ta`/`tes`. Use the imperative where possible.

**Why.** Tale is `tu` uniformly; `vous` puts distance between the product and the reader. Caught by `pronouns-formal`.

## 4. Calques

Subtle English idioms rendered literally in French. Reviewers catch these; no regex denylist today.

| Drift                                        | Target                               |
| -------------------------------------------- | ------------------------------------ |
| `boucle` (for "loop, as in in-the-loop")     | `informé`, `tenu au courant`         |
| `posture de confiance` (for "trust posture") | name the actual certifications       |
| `expérience utilisateur fluide et intuitive` | name what the experience consists of |

## 5. Half-translated compounds

Covered in [`../../BUCKETS.md`](../../BUCKETS.md) § "FR half-compounds" and enforced by `terminology-half-compound`. The mapping is regex-based in [`packages/ui/src/i18n/tests/locales/fr/terminology.ts`](../../../../../packages/ui/src/i18n/tests/locales/fr/terminology.ts).

## 6. NBSP miscues

Caught by `style-nbsp`. French requires NBSP before `:;!?%»` and after `«`. Regular space in these positions fires the check.

## 7. Apostrophe miscues

Caught by `style-apostrophes`. French prose uses typographic `’` between letters (`l’équipe`, `c’est`). ASCII `'` in prose fires the check; message values stay ASCII — `style-apostrophes` checks prose only, never the message file.

## When you find a new pattern

Document the drift here with one paragraph, one example, and one target. If it has a regex form, add to [`packages/ui/src/i18n/tests/locales/fr/voice.ts`](../../../../../packages/ui/src/i18n/tests/locales/fr/voice.ts) under `STRIKES`. Add a planted fixture under [`packages/ui/src/i18n/tests/locales/fr/planted/voice-strikes/`](../../../../../packages/ui/src/i18n/tests/locales/fr/planted/voice-strikes/).
