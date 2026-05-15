# French (fr) terminology

French base locale for the platform UI (`services/platform/messages/fr.json`), the marketing site (`services/web/messages/fr.json`), and the docs site (`docs/fr/` page bodies plus `services/docs/messages/fr.json` chrome strings). Cross-locale rules — voice, the loanword policy, length, plurals, placeholders — live in [`TERMINOLOGY.md`](TERMINOLOGY.md); read that file first. English source forms and the EN-specific doctrine live in [`TERMINOLOGY_EN.md`](TERMINOLOGY_EN.md).

This file is **doctrine only**: voice rules, anti-pattern descriptions, principles. Every concrete word list — product features, knowledge-base entities, technical vocabulary, action verbs, deployment vocabulary, Git-domain loanwords, role names, marketing softeners, drift→target examples, toast and error patterns, abbreviations — lives in [`GLOSSARY.json`](GLOSSARY.json). When this file and the glossary disagree, the glossary wins for words; this file wins for rules.

---

## 1 · The French voice — what it is, what it isn't

French translation drifts towards marketing softening, stacked nominal phrases, and untranslated English nouns. None of those land Tale's voice. The French narrator is the same calm, opinionated, second-person-informal voice as the English one.

### Five rules the voice always respects

**1. `tu`, never `vous`.** Across UI, marketing, and docs. Inflections (`ton`, `ta`, `tes`, `toi`) follow. Enforced by [`terminology.test.ts`](../../services/docs/tests/terminology.test.ts).

**2. Verb-first imperatives, not nominal stacks.** `Importe les documents…` — not `Procédez à l'import des documents…`. If the English is imperative, the French is imperative.

**3. Why before what.** Same as English. `Lance tale deploy — ça déclenche un déploiement blue-green ; l'ancien conteneur continue de servir le trafic jusqu'à ce que le nouveau passe ses health checks.`

**4. Same words across the corpus.** When two French nouns mean roughly the same thing, the glossary names which one Tale uses (`Site web` over `Site Web`, `Téléverser` over `Uploader`, `Courriel` over `Email` in prose, `Se connecter` over `Se logger`, `Agent` over `Assistant`). The canonical forms live across `productVocabulary.*` in [`GLOSSARY.json`](GLOSSARY.json).

**5. Respect non-breaking spaces.** Before `:`, `;`, `!`, `?`, `%`, and inside `« guillemets »`. JSON message files preserve the literal NBSP (U+00A0 or U+202F).

### Marketing softeners — strike on sight

The closed list of French marketing softeners lives at `marketingSofteners.fr` in [`GLOSSARY.json`](GLOSSARY.json). When you reach for one of them, delete it instead and let the demonstration carry the claim.

---

## 2 · The marketing drift — anti-pattern catalogue

These are the patterns French translators reach for under deadline pressure. The drift→target examples for each pattern live in [`GLOSSARY.json`](GLOSSARY.json) under `antiPatternExamples.fr.<patternKey>`.

### Anti-pattern 1 · Marketing softening

`Découvre`, `N'hésite pas à`, `il te suffit de`, `clé en main`, `puissant`, `simplement`. Replace with verb-first imperatives and concrete nouns. Examples at `antiPatternExamples.fr.marketingSoftening`.

### Anti-pattern 2 · Stacked nominal phrases

French (like English) can stack nouns, but stacks of more than three become hard to parse. Relative clauses are usually clearer. When you see three or more nouns chained by `de`, restructure. Examples at `antiPatternExamples.fr.stackedNominalPhrases`.

### Anti-pattern 3 · `vous`-Slips

`vous` is grammatically polite but Tale uses `tu`. Enforced by lint. Examples at `antiPatternExamples.fr.vousSlips`.

### Anti-pattern 4 · Calqued English idioms

When the English uses an abstract noun (`story`, `journey`, `posture`, `surface`), translate the meaning, not the noun. Some abstractions have established French equivalents (`parcours utilisateur`, `pipeline`); others don't and need a restructure. Examples at `antiPatternExamples.fr.calquedIdioms`.

### Anti-pattern 5 · The English word in the middle of a French sentence

Caught by [`loanword.test.ts`](../../services/docs/tests/loanword.test.ts) for Bucket 3 terms. The drift table lives at `antiPatternExamples.fr.englishMidSentence`; the canonical native forms are at `translateBucket.fr` in the glossary.

### Anti-pattern 6 · Lazy capitalisation

French capitalises only at the start of a sentence and for proper nouns. UI labels follow the shipped form. Examples at `antiPatternExamples.fr.lazyCapitalisation`.

### Anti-pattern 7 · Wrong apostrophe

French docs prose uses typographic `'` (`l'équipe`, `aujourd'hui`, `d'abord`). Inside `fr.json`, code blocks, and inline code spans, the source's ASCII `'` is preserved. Examples at `antiPatternExamples.fr.wrongApostrophe`.

### Anti-pattern 8 · Half-translated compound

A multi-word technical term split across languages: `Pull Demande`, `Code Review-Processus`, `Demande de fusion`, `Branche-fork`. Compound terms are translated whole or kept whole, never half. Examples at `antiPatternExamples.fr.halfTranslatedCompound`; see the no-half-translation rule in [`TERMINOLOGY.md`](TERMINOLOGY.md).

---

## 3 · Product vocabulary

Every concrete French term lives in [`GLOSSARY.json`](GLOSSARY.json):

- **`productVocabulary.features`** — Agent, Workflow, Base de connaissances, Canevas, Composeur, Approbations, Journal d'audit, Serveur MCP, etc.
- **`productVocabulary.knowledgeEntities`** — Site web, Client, Fournisseur (KB entity), Produit, Document, Dossier.
- **`productVocabulary.technicalVocab`** — API, LLM, Token, Prompt, Webhook, Fournisseur (LLM provider — use `Fournisseur IA` to disambiguate), DCP, etc.
- **`productVocabulary.actionVerbs`** — Enregistrer/Supprimer/Modifier/Annuler/…
- **`productVocabulary.deploymentVocab`** — Auto-hébergé, Sur site, Open source, Équipe, Branding, etc.
- **`gitDomainLoanwords.fr`** — Pull Request, Merge, Rebase, Branch, Commit, Push, Pull, Fork, Diff, Code Review, Issue, Repository, Tag, Release. These stay English; half-translated forms fail review.
- **`roleNames.matrix`** — the canonical Propriétaire / Admin / Développeur / Éditeur / Membre / Désactivé mapping.

The rules that govern those entries:

- **Match the shipped UI verbatim.** Before quoting a button or menu, grep `services/platform/messages/fr.json`. When the UI and the glossary disagree, update the UI first, then the glossary, in the same PR.
- **Disambiguate `Provider` vs Vendor**: `Fournisseur IA` for the LLM-provider concept; plain `Fournisseur` for the KB-entity Vendor.
- **The lint enforces all six role mappings**, including `Editor` → `Éditeur` (no ambiguity in FR — the same word serves both the role and the visual editor concept).
- **Bucket 3 terms must translate.** `Header → En-tête`, `Request → Requête`, `Provider → Fournisseur`, `Email → Courriel`, `Help Center → Centre d'aide`, `Billing → Facturation`, `Sales Research → Recherche commerciale`, `Engineering → Ingénierie` (in prose; loanword acceptable in job titles), `Draft → Brouillon`, `Attachment → Pièce jointe`, `Self-hosted → Auto-hébergé`. The full list and rationales live at `translateBucket.fr`.

---

## 4 · Toasts and error messages

Toast confirmations use past participle agreeing with the noun, no period, the noun first; `avec succès` is never included. Pattern and examples at `toastConventions.fr` in [`GLOSSARY.json`](GLOSSARY.json).

Error messages name what happened and what to do next, one sentence ending with a period, never blaming the reader. Per-pattern translations at `errorMessagePatterns`.

---

## 5 · Style rules

- **`tu`, never `vous`.** Across UI, marketing, and docs. Inflections (`ton`, `ta`, `tes`) follow.
- **Quotation marks:** `« guillemets français »` in running prose. Straight `"..."` inside UI labels and code blocks.
- **Apostrophes:** typographic `'` in docs prose (`l'équipe`, `aujourd'hui`, `d'abord`). Straight `'` inside UI labels (`fr.json`), code blocks, and inline code spans.
- **Non-breaking space** before `:`, `;`, `!`, `?`, `%`, and inside guillemets (`« texte »`). JSON files preserve the literal NBSP.
- **Decimal comma** in docs prose (`2,5 Go`). Inside code blocks and env var values, keep the period (`2.5`).
- **Thousands separator:** narrow non-breaking space (`1 000`).
- **Dates:** `DD/MM/YYYY` in docs prose (`19/04/2026`). In frontmatter and technical contexts, use ISO (`2026-04-19`).
- **Times:** 24-hour clock in user-facing copy (`09 h 00`, `17 h 30`). Cron expressions and server logs keep their canonical format.
- **Headings are sentence case.** Capitalise only the first word and proper nouns — `## Concepts des agents`, not `## Concepts des Agents`.
- **Gerunds:** avoid untranslated English `-ing` forms. `Le monitoring` → `La supervision` when the sense is Tale's Prometheus story. Keep `monitoring` only when it's a well-established tool category.
- **Inclusive forms:** prefer neutral nouns (`l'équipe`, `les personnes`) over `utilisateur·rice` in long-form docs. In space-tight UI, plain `utilisateur` is acceptable.
- **UI labels must match the product.** Before quoting a button or menu, grep `services/platform/messages/fr.json`.

The machine-readable form of these conventions lives at `styleConventions.fr` in [`GLOSSARY.json`](GLOSSARY.json).
