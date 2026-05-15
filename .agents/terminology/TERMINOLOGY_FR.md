# French (fr) terminology

French base locale for the platform UI (`services/platform/messages/fr.json`), the marketing site (`services/web/messages/fr.json`), and the docs site (`docs/fr/` page bodies plus `services/docs/messages/fr.json` chrome strings). Cross-locale rules — voice, the loanword policy, length, plurals, placeholders — live in [`TERMINOLOGY.md`](TERMINOLOGY.md); read that file first. English source forms live in [`TERMINOLOGY_EN.md`](TERMINOLOGY_EN.md).

---

## 1 · The French voice — what it is, what it isn't

French translation drifts towards marketing softening, stacked nominal phrases, and untranslated English nouns. None of those land Tale's voice. The French narrator is the same calm, opinionated, second-person-informal voice as the English one.

### Five rules the voice always respects

**1. `tu`, never `vous`.** Across UI, marketing, and docs. Inflections (`ton`, `ta`, `tes`, `toi`) follow. Enforced by [`terminology.test.ts`](../../services/docs/tests/terminology.test.ts).

**2. Verb-first imperatives, not nominal stacks.**

- `Importe les documents…` — not `Procédez à l'import des documents…`.
- `Ajoute une intégration` — not `L'ajout d'une intégration se fait…`.
- `Crée un agent` — not `La création d'un agent s'effectue…`.

If the English is imperative, the French is imperative.

**3. Why before what.** Same as English. `Lance tale deploy — ça déclenche un déploiement blue-green ; l'ancien conteneur continue de servir le trafic jusqu'à ce que le nouveau passe ses health checks.`

**4. Same words across the corpus.** Pick one and stay with it:

- `Site web` (not `Site Web`, not `site internet`). Matches `websites.title`.
- `Fournisseur IA` for the LLM provider concept; `Fournisseur` alone for the KB-entity Vendor.
- `Téléverser` (upload) — not `Uploader`.
- `Courriel` in prose, `Email` only when space-tight UI requires it.
- `Se connecter` / `Se déconnecter` (not `Se logger`).
- `Agent` (not `Assistant` — the product noun is `Agent`).

**5. Respect non-breaking spaces.** Before `:`, `;`, `!`, `?`, `%`, and inside `« guillemets »`. JSON message files preserve the literal NBSP (U+00A0 or U+202F).

### The Twelve Marketing Softeners — strike on sight (FR)

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

These are the patterns French translators reach for under deadline pressure. Every one of them is flagged at review.

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

French (like English) can stack nouns, but stacks of more than three readouts become hard to parse. Relative clauses are usually clearer.

| Drift                                                                              | Target                                                        |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `Une solution clé en main pour la gestion documentaire intégrée multilingue.`      | `Une solution qui gère les documents dans plusieurs langues.` |
| `Le système de notification d'événements de workflow par webhook personnalisable.` | `Des notifications de workflow par webhook, configurables.`   |
| `L'interface de configuration des règles de routage des fournisseurs.`             | `L'interface qui configure le routage entre fournisseurs.`    |

When you see three or more nouns chained by `de`, restructure.

### Anti-pattern 3 · `vous`-Slips

`vous` is grammatically polite but Tale uses `tu`. Enforced by lint.

| Drift                     | Target                                |
| ------------------------- | ------------------------------------- |
| `Vous pouvez configurer…` | `Tu peux configurer…` or `Configure…` |
| `N'oubliez pas de…`       | `N'oublie pas de…` or restructure     |
| `Veuillez patienter`      | `Patiente` or `Chargement…`           |
| `Contactez le support`    | `Contacte le support`                 |

### Anti-pattern 4 · Calqued English idioms

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

When the English uses an abstract noun, translate the meaning, not the noun.

### Anti-pattern 5 · The English word in the middle of a French sentence

Caught by [`loanword.test.ts`](../../services/docs/tests/loanword.test.ts).

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

### Anti-pattern 6 · Lazy capitalisation

| Drift                | Target                                                                   |
| -------------------- | ------------------------------------------------------------------------ |
| `chat avec L'IA`     | `Chat avec l'IA` (and `l'IA` lowercase, with the typographic apostrophe) |
| `dans Le knowledge…` | `dans la base de connaissances`                                          |
| `Webhook D'agent`    | `webhook d'agent` or `Webhook d'agent` (capitalise only first letter)    |

### Anti-pattern 7 · Wrong apostrophe

French docs prose uses typographic `'` (`l'équipe`, `aujourd'hui`, `d'abord`). Inside `fr.json`, code blocks, and inline code spans, the source's ASCII `'` is preserved.

| Where                                | Apostrophe        |
| ------------------------------------ | ----------------- |
| Docs prose (`docs/fr/**.md`)         | `'` (typographic) |
| `services/*/messages/fr.json` values | ASCII `'`         |
| Inside `inline code` spans           | as written        |
| Inside fenced code blocks            | as written        |

---

## 3 · Product features

Match the UI verbatim — if the two ever disagree, update the UI first, then this file.

| English              | French                     | Notes                                                                                                  |
| -------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------ |
| Agent                | Agent                      | Same spelling in French.                                                                               |
| Chat / Chat with AI  | Discuter avec l'IA         | Matches UI label `navigation.chatWithAI`. Plain `Chat` (loanword) is acceptable when context is clear. |
| Conversations        | Conversations              | Multi-channel inbox feature. Matches UI label `navigation.conversations`.                              |
| Workflow             | Workflow                   | Established loanword.                                                                                  |
| Automation(s)        | Automatisation(s)          | Matches UI label `navigation.automations`.                                                             |
| Integration(s)       | Intégration(s)             | Matches UI label `navigation.integrations`.                                                            |
| Dashboard            | Dashboard                  | Loanword.                                                                                              |
| Knowledge            | Connaissances              |                                                                                                        |
| Knowledge base       | Base de connaissances      |                                                                                                        |
| Workspace            | Espace de travail          |                                                                                                        |
| Canvas               | Canevas                    | Matches UI label `chat.canvas.title` — **not** the English `Canvas`.                                   |
| Composer             | Composeur                  | Matches UI label `composer.openMenu`.                                                                  |
| Prompt library       | Bibliothèque de prompts    | Matches UI label `chat.promptLibrary` — **not** the loanword `Prompt Library`.                         |
| Arena Mode           | Mode Arène                 | Matches UI label `chat.arena.title`. Capitalise `Arène` as part of the feature name.                   |
| Research plan        | Plan de recherche          | Matches UI label `todoList.title` — **never** `Liste de tâches`.                                       |
| Approval / Approvals | Approbation / Approbations | Singular for one pending item; plural for the workspace view. **Never** `Validation(s)`.               |
| Human input request  | Demande utilisateur        | Fall back to `Question à l'utilisateur` if the UI string is unclear.                                   |
| Location request     | Demande de localisation    | Matches UI label `locationRequest.title`.                                                              |
| Audit log            | Journal d'audit            |                                                                                                        |
| Legal hold           | Conservation légale        | Long-form; `Legal hold` acceptable as a loanword in technical sections where the term-of-art matters.  |

---

## 4 · Knowledge-base entities

| English              | French                     | Notes                                                                                               |
| -------------------- | -------------------------- | --------------------------------------------------------------------------------------------------- |
| Website / Websites   | Site web / Sites web       | Two words. Matches UI label `websites.title`.                                                       |
| Customer / Customers | Client / Clients           | Matches UI label `customers.title`.                                                                 |
| Vendor / Vendors     | Fournisseur / Fournisseurs | Overloads with `Provider` below — disambiguate by context. For the KB entity, always `Fournisseur`. |
| Product / Products   | Produit / Produits         | Matches UI label `products.title`.                                                                  |
| Document / Documents | Document / Documents       | Matches UI label `documents.title`.                                                                 |
| Thread               | **Conversation**           | Use `Conversation` in user-facing prose. `Thread` stays only in code and API identifiers.           |
| Folder               | Dossier                    |                                                                                                     |

---

## 5 · Technical vocabulary

| English        | French                | Notes                                                                                                  |
| -------------- | --------------------- | ------------------------------------------------------------------------------------------------------ |
| AI             | IA                    | Intelligence artificielle.                                                                             |
| API            | API                   | Loanword.                                                                                              |
| LLM            | LLM                   | Loanword.                                                                                              |
| Token          | Token                 | Loanword.                                                                                              |
| Prompt         | Prompt                | Loanword.                                                                                              |
| Webhook        | Webhook               | Loanword.                                                                                              |
| Provider       | Fournisseur           | **Translate** — never leave as `Provider`. Use `Fournisseur IA` to disambiguate from KB-entity Vendor. |
| Settings       | Paramètres            |                                                                                                        |
| PII            | DCP                   | Données à caractère personnel. Expand on first use per page.                                           |
| MCP server     | Serveur MCP           | Matches UI label `mcpServers.title`.                                                                   |
| API key        | Clé API               |                                                                                                        |
| User           | Utilisateur           | In generic use. Only reach for `utilisateur·rice` when gender inclusion is essential.                  |
| Browser        | Navigateur            |                                                                                                        |
| Status         | Statut                | `État` also acceptable; pick one per page.                                                             |
| Tool           | Tool                  | Loanword in product context (agent tools). Use `outil` in metaphors.                                   |
| Pipeline       | Pipeline              | Loanword.                                                                                              |
| Cache          | Cache                 | Loanword.                                                                                              |
| Snapshot       | Snapshot              | Loanword. `instantané` is acceptable in long-form prose.                                               |
| Endpoint       | Endpoint              | Loanword. `point de terminaison` is acceptable in long-form prose.                                     |
| Payload        | Payload               | Loanword. `charge utile` is acceptable in long-form prose.                                             |
| Rate limit     | Limite de requêtes    | Native phrase. `Rate limit` is acceptable as a loanword in technical sections.                         |
| Email          | Courriel              | **Translate** — prose uses `courriel`. Space-tight UI may abbreviate to `Email`.                       |
| Header         | En-tête               | **Translate**.                                                                                         |
| Request        | Requête               | **Translate**. Use `requête HTTP` for clarity if needed.                                               |
| Help Center    | Centre d'aide         | **Translate**.                                                                                         |
| Billing        | Facturation           | **Translate**.                                                                                         |
| Sales Research | Recherche commerciale | **Translate**.                                                                                         |
| Engineering    | Ingénierie            | **Translate** in prose. Loanword `Engineering` acceptable only in job-title contexts.                  |
| Draft          | Brouillon             | **Translate**.                                                                                         |
| Attachment     | Pièce jointe          | **Translate**.                                                                                         |
| Backup         | Sauvegarde            | Native noun.                                                                                           |
| Health check   | Health check          | Loanword. `Vérification de santé` is acceptable in long-form prose.                                    |
| Reverse proxy  | Reverse proxy         | Loanword. `Proxy inverse` is acceptable in long-form prose.                                            |

---

## 6 · Actions and state verbs

| English   | French                 | Notes                                                                      |
| --------- | ---------------------- | -------------------------------------------------------------------------- |
| Save      | Enregistrer            |                                                                            |
| Delete    | Supprimer              |                                                                            |
| Edit      | Modifier               |                                                                            |
| Cancel    | Annuler                |                                                                            |
| Confirm   | Confirmer              |                                                                            |
| Close     | Fermer                 |                                                                            |
| Add       | Ajouter                |                                                                            |
| Remove    | Retirer / Supprimer    | `Retirer` for collections (`retirer un membre`), `Supprimer` for deletion. |
| Create    | Créer                  |                                                                            |
| Duplicate | Dupliquer              |                                                                            |
| Send      | Envoyer                |                                                                            |
| Receive   | Recevoir               |                                                                            |
| Approve   | Approuver              |                                                                            |
| Reject    | Rejeter / Refuser      |                                                                            |
| Publish   | Publier                |                                                                            |
| Archive   | Archiver               |                                                                            |
| Restore   | Restaurer              |                                                                            |
| Enable    | Activer                |                                                                            |
| Disable   | Désactiver             |                                                                            |
| Log in    | Se connecter           |                                                                            |
| Log out   | Se déconnecter         |                                                                            |
| Sign up   | S'inscrire             |                                                                            |
| Upload    | Téléverser             | Verb. Noun: `téléversement`.                                               |
| Download  | Télécharger            |                                                                            |
| Back up   | Sauvegarder            | The noun `Backup` is `sauvegarde`.                                         |
| Set up    | Configurer / Installer | Both work; pick by context.                                                |

### Toast-message conventions (FR)

State-change confirmations. Past participle agreeing with the noun, no period, the noun comes first. `Avec succès` is never included.

| Pattern                        | Example                           |
| ------------------------------ | --------------------------------- |
| `<Noun> <past-participle>`     | `Agent enregistré`                |
| `<Noun> <past-participle>`     | `Fournisseur supprimé`            |
| `<Noun> <past-participle>`     | `Workflow publié`                 |
| `<Noun> <past-participle> (e)` | `Approbation acceptée` (feminine) |

---

## 7 · Deployment vocabulary

| English        | French                | Notes                                                      |
| -------------- | --------------------- | ---------------------------------------------------------- |
| Self-hosted    | Auto-hébergé          | **Translate** — hyphenated.                                |
| On-premises    | Sur site              | Alternative loanword: `on-premises`. Prefer `sur site`.    |
| Open source    | Open source           | Loanword; invariable.                                      |
| Zero-downtime  | Zero-downtime         | Keep English.                                              |
| Blue-green     | Blue-green            | Keep English.                                              |
| Team           | Équipe                | Singular form carries the accent.                          |
| Branding       | Branding              | Loanword.                                                  |
| Air-gapped     | Air-gapped            | Loanword. `Isolé du réseau` acceptable in long-form prose. |
| Data residency | Résidence des données | Native phrase.                                             |

---

## 8 · Role names

Translate role names to match the shipped FR UI labels (`services/platform/messages/fr.json`):

| English   | FR form          |
| --------- | ---------------- |
| Owner     | **Propriétaire** |
| Admin     | **Admin**        |
| Developer | **Développeur**  |
| Editor    | **Éditeur**      |
| Member    | **Membre**       |
| Disabled  | **Désactivé**    |

Capitalise when naming the role (`un Propriétaire peut transférer la propriété`); lowercase when the word is generic (`les membres de ton équipe utilisent le chat`).

The lint enforces these mappings, including `Editor` → `Éditeur` (FR uses the same word for role and IDE/visual editor, so there's no ambiguity).

---

## 9 · Style rules

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

---

## Quick reference

| Question                               | Answer                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------- |
| `tu` or `vous`?                        | `tu`. Always. Inflections too.                                             |
| `Découvre` at the start of a sentence? | No. Strike or replace with `Lis`, `Ouvre`, `Va voir`.                      |
| `Header` or `En-tête`?                 | `En-tête` in prose.                                                        |
| `Email` or `Courriel`?                 | `Courriel` in prose. UI may abbreviate to `Email` for space.               |
| `Provider` or `Fournisseur`?           | `Fournisseur`. Use `Fournisseur IA` to disambiguate from KB-entity Vendor. |
| `Self-hosted` or `auto-hébergé`?       | `Auto-hébergé`.                                                            |
| `Workflow` or `flux de travail`?       | `Workflow`. Established loanword.                                          |
| `Canvas` or `Canevas`?                 | `Canevas`. Matches the shipped UI.                                         |
| `Sauvegarder` or `Enregistrer`?        | `Enregistrer` for save-state. `Sauvegarder` for backup operations.         |
| Typographic apostrophe in `fr.json`?   | No. ASCII `'` in JSON. Typographic `'` only in `docs/fr/**.md`.            |
| NBSP before `:` in JSON?               | Yes — preserve the literal U+00A0.                                         |
