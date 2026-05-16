# French (fr) terminology

French base locale for the platform UI (`services/platform/messages/fr.json`), the marketing site (`services/web/messages/fr.json`), and the docs site (`docs/fr/` page bodies plus `services/docs/messages/fr.json` chrome strings). Cross-locale rules — voice, the loanword policy, length, plurals, placeholders — live in [`TERMINOLOGY.md`](TERMINOLOGY.md); read that file first. English source forms and the EN-specific doctrine live in [`TERMINOLOGY_EN.md`](TERMINOLOGY_EN.md).

**Where things live.** Doctrine + illustrative drift→target tables live in this file. Term lookups live in [`GLOSSARY.json`](GLOSSARY.json) `terms[]` (filter by `category` and check the `fr` field). Test-data lists (formal pronouns, German noun-gender map) live in [`services/docs/tests/data/`](../../services/docs/tests/data/).

---

## 1 · The French voice — what it is, what it isn't

French translation drifts towards marketing softening, stacked nominal phrases, and untranslated English nouns. None of those land Tale's voice. The French narrator is the same calm, opinionated, second-person-informal voice as the English one.

### Five rules the voice always respects

**1. `tu`, never `vous`.** Across UI, marketing, and docs. Inflections (`ton`, `ta`, `tes`, `toi`) follow. Enforced by [`terminology-pronouns.test.ts`](../../services/docs/tests/terminology-pronouns.test.ts); the formal-pronoun denylist lives at [`services/docs/tests/data/formal-pronouns.ts`](../../services/docs/tests/data/formal-pronouns.ts).

**2. Verb-first imperatives, not nominal stacks.**

- `Importe les documents…` — not `Procédez à l'import des documents…`.
- `Ajoute une intégration` — not `L'ajout d'une intégration se fait…`.
- `Crée un agent` — not `La création d'un agent s'effectue…`.

If the English is imperative, the French is imperative.

**3. Why before what.** Same as English. `Lance tale deploy — ça déclenche un déploiement blue-green ; l'ancien conteneur continue de servir le trafic jusqu'à ce que le nouveau passe ses health checks.`

**4. Same words across the corpus.** When two French nouns mean roughly the same thing, the glossary names which one Tale uses (`Site web` over `Site Web`, `Téléverser` over `Uploader`, `Courriel` over `Email` in prose, `Se connecter` over `Se logger`, `Agent` over `Assistant`).

**5. Respect non-breaking spaces.** Before `:`, `;`, `!`, `?`, `%`, and inside `« guillemets »`. JSON message files preserve the literal NBSP (U+00A0 or U+202F).

### Marketing softeners — strike on sight (FR)

| Strike FR form                          | Replace with                                 |
| --------------------------------------- | -------------------------------------------- |
| `Découvre` / `Découvrez`                | `Lis`, `Ouvre`, `Va voir`                    |
| `N'hésite pas à` / `N'hésitez pas à`    | (delete; imperative does the work)           |
| `tout simplement`                       | (delete)                                     |
| `il te suffit de` / `il vous suffit de` | (delete; replace with the imperative)        |
| `simplement`                            | (delete)                                     |
| `facilement`                            | (delete)                                     |
| `en toute simplicité`                   | (delete)                                     |
| `puissant`                              | (delete or replace with concrete capability) |
| `clé en main`                           | (delete; describe what's pre-configured)     |
| `profite` / `profitez de`               | (delete; the demonstration carries it)       |
| `bénéficie` / `bénéficiez de`           | (delete)                                     |
| `s'il te plaît` / `s'il vous plaît`     | (delete; imperative does the work)           |

---

## 2 · The marketing drift — anti-pattern catalogue

These are the patterns French translators reach for under deadline pressure. Every one is flagged at review.

### Anti-pattern 1 · Marketing softening

| Drift                                                            | Target                                           |
| ---------------------------------------------------------------- | ------------------------------------------------ |
| `Découvre comment configurer un agent en toute simplicité.`      | `Configure un agent.`                            |
| `N'hésite pas à téléverser tes documents.`                       | `Téléverse les documents pertinents.`            |
| `Il te suffit de cliquer sur **Sauvegarder** pour valider.`      | `Clique sur **Enregistrer**.`                    |
| `Profite d'une intégration clé en main avec ton fournisseur IA.` | `Ajoute un Fournisseur IA et choisis le modèle.` |
| `Bénéficie de la puissance de Tale.`                             | (delete; describe what Tale does)                |
| `Tale te permet simplement de…`                                  | `Tale fait X.`                                   |

### Anti-pattern 2 · Stacked nominal phrases

French (like English) can stack nouns, but stacks of more than three become hard to parse. Relative clauses are usually clearer. When you see three or more nouns chained by `de`, restructure.

| Drift                                                                              | Target                                                        |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `Une solution clé en main pour la gestion documentaire intégrée multilingue.`      | `Une solution qui gère les documents dans plusieurs langues.` |
| `Le système de notification d'événements de workflow par webhook personnalisable.` | `Des notifications de workflow par webhook, configurables.`   |
| `L'interface de configuration des règles de routage des fournisseurs.`             | `L'interface qui configure le routage entre fournisseurs.`    |

### Anti-pattern 3 · `vous`-Slips

`vous` is grammatically polite but Tale uses `tu`. Enforced by lint.

| Drift                     | Target                                |
| ------------------------- | ------------------------------------- |
| `Vous pouvez configurer…` | `Tu peux configurer…` or `Configure…` |
| `N'oubliez pas de…`       | `N'oublie pas de…` or restructure     |
| `Veuillez patienter`      | `Patiente` or `Chargement…`           |
| `Contactez le support`    | `Contacte le support`                 |

### Anti-pattern 4 · Calqued English idioms

When the English uses an abstract noun, translate the meaning, not the noun.

| EN source                       | Calque (wrong)                       | Native (right)                                              |
| ------------------------------- | ------------------------------------ | ----------------------------------------------------------- |
| `Published certification story` | `Histoire de certifications publiée` | `Nos certifications publiques` or name them                 |
| `Trust posture`                 | `Posture de confiance`               | `Nos certifications` (concrete) or `Notre posture sécurité` |
| `Operational surface`           | `Surface opérationnelle`             | `L'exploitation`                                            |
| `User journey`                  | `Parcours utilisateur`               | OK as-is — `parcours utilisateur` is established FR.        |
| `Data story`                    | `Histoire de données`                | `Données` or `Trajet des données`                           |
| `In the loop`                   | `Dans la boucle`                     | `Impliqué` or `Au courant`                                  |
| `Out of the box`                | `Prêt à l'emploi`                    | OK as-is, or describe what's pre-configured.                |
| `On the fly`                    | `À la volée`                         | OK as-is — established FR.                                  |
| `Pipeline of events`            | `Pipeline d'événements`              | OK — `pipeline` is established FR for tech.                 |

### Anti-pattern 5 · English noun in the middle of a French sentence

Caught by [`terminology-loanword.test.ts`](../../services/docs/tests/terminology-loanword.test.ts) for the Bucket-3 set.

| Drift                                               | Target                                                                        |
| --------------------------------------------------- | ----------------------------------------------------------------------------- |
| `Ouvre le Header du tableau.`                       | `Ouvre l'en-tête du tableau.`                                                 |
| `Un workflow d'exemple pour Sales Research.`        | `Un workflow d'exemple pour la recherche commerciale.`                        |
| `Envoie ton Request à l'API.`                       | `Envoie ta requête à l'API.`                                                  |
| `Configure ton Email Provider.`                     | `Configure ton fournisseur de courriel.`                                      |
| `Cet agent gère les questions Billing.`             | `Cet agent gère les questions de facturation.`                                |
| `Tu peux faire tourner le workflow en Self-hosted.` | `Tu peux faire tourner le workflow en auto-hébergé.`                          |
| `Téléverse le Draft.`                               | `Téléverse le brouillon.`                                                     |
| `Ajoute l'Attachment.`                              | `Ajoute la pièce jointe.`                                                     |
| `L'équipe Engineering.`                             | `L'équipe d'ingénierie.` (in prose; job-title context may keep `Engineering`) |

### Anti-pattern 6 · Half-translated compound

| Drift                   | Target                                 |
| ----------------------- | -------------------------------------- |
| `Pull Demande`          | `Pull Request` (keep whole English)    |
| `Code Review-Processus` | `Code Review` (drop `-Processus`)      |
| `Demande de fusion`     | `Pull Request`                         |
| `Branche-fork`          | `Branch` or `Fork` — never both halves |

### Anti-pattern 7 · Lazy capitalisation

| Drift                | Target                                                                   |
| -------------------- | ------------------------------------------------------------------------ |
| `chat avec L'IA`     | `Chat avec l'IA` (and `l'IA` lowercase, with the typographic apostrophe) |
| `dans Le knowledge…` | `dans la base de connaissances`                                          |
| `Webhook D'agent`    | `webhook d'agent` or `Webhook d'agent` (capitalise only first letter)    |

### Anti-pattern 8 · Wrong apostrophe

French docs prose uses typographic `'` (`l'équipe`, `aujourd'hui`, `d'abord`). Inside `fr.json`, code blocks, and inline code spans, the source's ASCII `'` is preserved.

| Where                                | Apostrophe        |
| ------------------------------------ | ----------------- |
| Docs prose (`docs/fr/**.md`)         | `'` (typographic) |
| `services/*/messages/fr.json` values | ASCII `'`         |
| Inside `inline code` spans           | as written        |
| Inside fenced code blocks            | as written        |

---

## 3 · Product vocabulary

Every concrete French term lives as a flat entry in [`GLOSSARY.json`](GLOSSARY.json) under `terms[]`. Filter by `category` (feature, knowledgeEntity, technicalVocab, actionVerb, deploymentVocab, role, brand, acronym, loanword, gitDomain, translateBucket, abbreviation) and check the `fr` field.

Rules that govern those entries:

- **Match the shipped UI verbatim.** Before quoting a button or menu, grep `services/platform/messages/fr.json`.
- **Disambiguate `Provider` vs Vendor**: `Fournisseur IA` for the LLM-provider concept; plain `Fournisseur` for the KB-entity Vendor.
- **The lint enforces all six role mappings**, including `Editor` → `Éditeur` (no ambiguity in FR — the same word serves both the role and the visual editor concept).
- **Bucket 3 terms must translate.** `Header → En-tête`, `Request → Requête`, `Provider → Fournisseur`, `Email → Courriel`, `Help Center → Centre d'aide`, `Billing → Facturation`, `Sales Research → Recherche commerciale`, `Engineering → Ingénierie` (in prose; loanword acceptable in job titles), `Draft → Brouillon`, `Attachment → Pièce jointe`, `Self-hosted → Auto-hébergé`.

---

## 4 · Toasts and error messages

Toast confirmations use past participle agreeing with the noun, no period, the noun first. **`Avec succès` is never included.**

| Pattern                        | Example                           |
| ------------------------------ | --------------------------------- |
| `<Noun> <past-participle>`     | `Agent enregistré`                |
| `<Noun> <past-participle>`     | `Fournisseur supprimé`            |
| `<Noun> <past-participle>`     | `Workflow publié`                 |
| `<Noun> <past-participle (e)>` | `Approbation acceptée` (feminine) |

Error messages name what happened and what to do next, one sentence ending with a period, never blaming the reader. The cross-locale pattern table lives in [`TERMINOLOGY.md`](TERMINOLOGY.md) §5.

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

### Date and number formatting

| Surface             | Format                                         |
| ------------------- | ---------------------------------------------- |
| Date in prose       | `19/04/2026`                                   |
| ISO date in code    | `2026-04-19`                                   |
| Decimal in prose    | `2,5 Go`                                       |
| Decimal in code     | `2.5`                                          |
| Thousands separator | `1 000` (narrow non-breaking space)            |
| Time, wall clock    | `09 h 00`, `22 h 30` (24-hour)                 |
| Time, server-side   | UTC, 24-hour                                   |
| Units               | `Mo`, `Go`, `s`, `ms`                          |
| Currency            | `100 €`, `100 CHF`                             |
| Percent             | `5 %` (non-breaking space)                     |
| Quote marks         | `« text »` in prose (NBSP); `"..."` in UI/code |
| Apostrophe          | `'` typographic in prose; ASCII in JSON/code   |
