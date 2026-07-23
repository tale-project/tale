# French (fr) — voice doctrine

This file covers every value in `services/*/messages/fr.yml` and every page under `docs/fr/`. The cross-locale contract is at [`../../SKILL.md`](../../SKILL.md); read that first.

## The voice in this language

French Tale prose is calm, opinionated, and verb-first. The second-person `tu` is the only address. Imperatives carry walkthroughs (`Ouvre **Paramètres > Membres** et clique sur **Inviter un membre**.`). Sentences are short to medium; relative clauses (`qui`, `que`) carry detail rather than stacked nominal phrases (`de … de … de …`). The French narrator is the same narrator as the English one — peer-to-peer, why-before-what.

> **Positive example.** Ouvre **Paramètres > Membres** et clique sur **Inviter un membre**. Le nouveau membre reçoit un lien par e-mail valide 24 heures et atterrit dans le rôle par défaut que tu choisis — change-le dans le formulaire avant d'envoyer s'il ne doit pas être Membre.

Three sentences, `tu`/`-le`, no `vous`, no `Découvre`, no `N'hésite pas à`. NBSP before `:` and around guillemets. The 24-hour expiry is a consequence the reader needs and the prose lands it inline.

## The drift mode this language slips into

French prose drifts into marketing softening. Three named patterns recur:

1. **Marketing-softener strikes** — `Découvre(z)`, `N'hésite(z) pas à`, `tout simplement`, `il te/vous suffit de`, `simplement`, `facilement`, `clé en main`, `Profite(z) de`, `Bénéficie(z) de`, `puissant(e)`, `en toute simplicité`. Each asserts a quality the page should demonstrate.
2. **Stacked nominal phrases (3+ `de` chains)** — _Une solution clé en main pour la gestion documentaire intégrée multilingue_. Native French uses a relative clause: _Une solution qui gère les documents dans plusieurs langues_.
3. **`vous`-slips** — formal `vous` / `votre` / `vos` in prose. Tale is `tu` uniformly.

> **Drift → target.** _Découvrez notre nouvelle fonctionnalité de Knowledge Base puissante et clé en main._
>
> _Ouvre la **Base de connaissances**. Elle indexe automatiquement les documents que tu charges et les rend disponibles aux agents en 30 secondes._
>
> The drift uses three softeners (`Découvrez`, `puissante`, `clé en main`) and a half-translated compound (`Knowledge Base`). The target switches to the imperative, names the concrete behaviour (30-second indexing), uses the shipped UI label.

Regex-checkable forms live in [`packages/ui/src/i18n/tests/locales/fr/voice.ts`](../../../../../packages/ui/src/i18n/tests/locales/fr/voice.ts) (caught by `voice-strikes`). Nominal-stacking is reviewer-caught.

## Conventions

See [CONVENTIONS.md](../../CONVENTIONS.md) for the template; values below are FR's.

| Surface                          | Rule                                   |
| -------------------------------- | -------------------------------------- |
| Pronoun (informal you)           | `tu` — never `vous`                    |
| Quotation marks (prose)          | `« text »` with NBSP inside guillemets |
| Quotation marks (message file)   | ASCII `"`                              |
| Apostrophe (prose)               | Typographic `’` — `l’équipe`, `c’est`  |
| Apostrophe (message file & code) | ASCII `'`                              |
| Dates (prose)                    | `19/04/2026` (DD/MM/YYYY)              |
| Dates (code / ISO)               | `2026-04-19`                           |
| Time (wall clock)                | 24-hour: `09:00`, `22:30`              |
| Decimal separator                | `,`                                    |
| Thousands separator              | NNBSP (` `, U+202F): `1 000`           |
| Currency                         | `100 €` (suffix, NBSP)                 |
| Percent                          | `5 %` (NBSP between number and `%`)    |
| Spelling                         | n/a                                    |
| NBSP before punctuation          | yes, before `:;!?%»` and after `«`     |
| En-dash for ranges               | yes: `2010–2020`                       |
| Em-dash style                    | spaced `—`                             |

## Loanword stance

French keeps bucket-1 and bucket-2 English; bucket-3 translates. Reminders:

- **Stay English in FR prose:** `Workflow`, `Dashboard`, `Cloud`, `Webhook`, `Token`, `Server`, `Pipeline`, `Pull Request`, `Branch`, `Merge`, `Commit`, `Code Review`, `MCP`.
- **Translate in FR prose:** `Header` → `En-tête`, `Request` → `Requête`, `Email` → `Courriel` (in formal prose) or `e-mail` (in conversational prose), `Help Center` → `Centre d'aide`, `Knowledge Base` → `Base de connaissances`, `Draft` → `Brouillon`, `Attachment` → `Pièce jointe`, `Self-hosted` → `auto-hébergé`, `Engineering` → `Ingénierie`.

## What ships untranslated

| EN        | FR           |
| --------- | ------------ |
| Owner     | Propriétaire |
| Admin     | Admin        |
| Developer | Développeur  |
| Editor    | Éditeur      |
| Member    | Membre       |
| Disabled  | Désactivé    |

Plus every Bucket 1 brand, acronym, and code identifier.

## When the locale-specific test fires

The FR checks live in [`packages/ui/src/i18n/tests/checks/`](../../../../../packages/ui/src/i18n/tests/checks/) and read [`packages/ui/src/i18n/tests/locales/fr/`](../../../../../packages/ui/src/i18n/tests/locales/fr/) data.

The most common firings:

- `pronouns-formal` — `vous` / `votre` / `vos` mid-sentence. Rewrite to `tu`.
- `voice-strikes` — `Découvrez`, `N'hésite pas à`, `tout simplement`, `puissant`, `clé en main`. Demonstrate, don't assert.
- `terminology-loanword` — translate-bucket noun left English. Use the locale form.
- `terminology-half-compound` — `Pull Demande`, `Branch Branche`, `Knowledge Base` in FR prose.
- `style-nbsp` — regular space before `:;!?%»`. Use NBSP (U+00A0).
- `style-apostrophes` — ASCII `'` between letters in prose. Use typographic `’`.

> **Sample failure.** `[style-nbsp] style-nbsp — 2 findings: services/web/messages/fr.yml  cta.title: [nbsp-missing] regular space before French punctuation — use NBSP ( ) before "; : ! ? %"`

## Worked examples

See [examples.md](examples.md) for positive examples and drift→target pairs.
