# French (fr) terminology

French base locale for the platform UI (`services/platform/messages/fr.json`), the marketing site (`services/web/messages/fr.json`), and the docs site (`docs/fr/` page bodies plus `services/docs/messages/fr.json` chrome strings). Cross-locale rules — length, tone, plurals, placeholders — live in [`TERMINOLOGY.md`](TERMINOLOGY.md); read that file first. English source forms live in [`TERMINOLOGY_EN.md`](TERMINOLOGY_EN.md).

The Swiss variant extends this file with deltas only:

- [`TERMINOLOGY_FR_CH.md`](TERMINOLOGY_FR_CH.md) — Swiss French

## Product features

Match the UI verbatim — if the two ever disagree, update the UI first, then this file.

| English              | French                     | Notes                                                                                                                   |
| -------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Agent                | Agent                      | Same spelling in French.                                                                                                |
| Chat / Chat with AI  | Discuter avec l'IA         | Matches UI label `navigation.chatWithAI`. Plain `Chat` (loanword) is acceptable when context is clear.                  |
| Conversations        | Conversations              | Multi-channel inbox feature. Matches UI label `navigation.conversations`.                                               |
| Workflow             | Workflow                   | Established loanword.                                                                                                   |
| Automation(s)        | Automatisation(s)          | Matches UI label `navigation.automations`.                                                                              |
| Integration(s)       | Intégration(s)             | Matches UI label `navigation.integrations`.                                                                             |
| Dashboard            | Dashboard                  | Loanword.                                                                                                               |
| Knowledge            | Connaissances              |                                                                                                                         |
| Knowledge base       | Base de connaissances      |                                                                                                                         |
| Workspace            | Espace de travail          |                                                                                                                         |
| Canvas               | Canevas                    | Matches UI label `chat.canvas.title` — **not** the English `Canvas`.                                                    |
| Composer             | Composeur                  | Matches UI label `composer.openMenu` (`menu du composeur`).                                                             |
| Prompt library       | Bibliothèque de prompts    | Matches UI label `chat.promptLibrary` — **not** the loanword `Prompt Library`.                                          |
| Arena Mode           | Mode Arène                 | Matches UI label `chat.arena.title`. Capitalize `Arène` as part of the feature name.                                    |
| Research plan        | Plan de recherche          | Matches UI label `todoList.title` — **never** `Liste de tâches`.                                                        |
| Approval / Approvals | Approbation / Approbations | Singular for one pending item; plural for the workspace view. **Never** `Validation(s)` for this feature.               |
| Human input request  | Demande utilisateur        | Context: a workflow step paused on a typed answer. Fall back to `Question à l'utilisateur` if the UI string is unclear. |
| Location request     | Demande de localisation    | Matches UI label `locationRequest.title`.                                                                               |

## Knowledge-base entities

| English              | French                     | Notes                                                                                                           |
| -------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Website / Websites   | Site web / Sites web       | Two words. Matches UI label `websites.title`.                                                                   |
| Customer / Customers | Client / Clients           | Matches UI label `customers.title`.                                                                             |
| Vendor / Vendors     | Fournisseur / Fournisseurs | Overloads with `Provider` below — disambiguate by context. For the knowledge-base entity, always `Fournisseur`. |
| Product / Products   | Produit / Produits         | Matches UI label `products.title`.                                                                              |
| Document / Documents | Document / Documents       | Matches UI label `documents.title`.                                                                             |
| Thread               | **Conversation**           | Use `Conversation` in user-facing prose. `Thread` stays only in code and API identifiers.                       |

## Technical vocabulary

| English                    | French       | Notes                                                                                                       |
| -------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------- |
| AI                         | IA           | Intelligence artificielle.                                                                                  |
| API / LLM / Token / Prompt | Keep English | Universal tech terms.                                                                                       |
| Webhook                    | Webhook      | Loanword.                                                                                                   |
| Provider                   | Fournisseur  |                                                                                                             |
| Settings                   | Paramètres   |                                                                                                             |
| PII                        | DCP          | Données à caractère personnel. Expand on first use per page.                                                |
| MCP server                 | Serveur MCP  | Matches UI label `mcpServers.title`.                                                                        |
| User                       | Utilisateur  | In mixed/generic use. Only reach for `utilisateur·rice` when gender inclusion is essential to the sentence. |
| Browser                    | Navigateur   |                                                                                                             |
| Email                      | Email        | One word, no hyphen. Lowercase `email` in prose, capitalize as a label. Matches the EN form.                |

## Actions and state verbs

| English  | French         | Notes                            |
| -------- | -------------- | -------------------------------- |
| Save     | Enregistrer    |                                  |
| Delete   | Supprimer      |                                  |
| Edit     | Modifier       |                                  |
| Log in   | Se connecter   |                                  |
| Log out  | Se déconnecter |                                  |
| Sign up  | S'inscrire     |                                  |
| Upload   | Téléverser     | Verb; noun form `téléversement`. |
| Download | Télécharger    |                                  |

## Deployment vocabulary

| English       | French        | Notes                                |
| ------------- | ------------- | ------------------------------------ |
| Self-hosted   | Auto-hébergé  | Hyphenated.                          |
| On-premises   | Sur site      | Alternative loanword: `on-premises`. |
| Open source   | Open source   | Loanword; invariable.                |
| Zero-downtime | Zero-downtime | Keep English.                        |
| Blue-green    | Blue-green    | Keep English.                        |
| Team          | Équipe        | Singular form carries the accent.    |
| Branding      | Branding      | Loanword.                            |

## Role names

Translate role names to match the shipped FR UI labels (`services/platform/messages/fr.json`):

| English   | FR form          |
| --------- | ---------------- |
| Owner     | **Propriétaire** |
| Admin     | **Admin**        |
| Developer | **Développeur**  |
| Editor    | **Éditeur**      |
| Member    | **Membre**       |
| Disabled  | **Désactivé**    |

Capitalize when naming the role (`un Propriétaire peut transférer la propriété`); use lowercase when the word is purely generic and matches the everyday French noun (`les membres de ton équipe utilisent le chat`). The sense is identical to English — capitalize when you are naming the role, not when you are using the noun in its everyday meaning.

The lint enforces these mappings, including `Editor` → `Éditeur` (FR uses the same word for role and IDE/visual editor, so there is no ambiguity to preserve).

## Style rules

- **`tu`, never `vous`.** The informal form is used consistently across UI and docs.
- **Quotation marks:** « guillemets français » in running prose. Straight `"..."` inside UI labels and code blocks.
- **Apostrophes:** typographic `’` in docs prose (`l’équipe`, `aujourd’hui`, `d’abord`). Straight `'` inside UI labels (`fr.json`), code blocks, and inline code spans — preserve the source form when quoting strings from the codebase.
- **Non-breaking space** before `:`, `;`, `!`, `?`, `%`, and inside guillemets (`« texte »`). Markdown rendering normalizes a regular space, but preserve the exact character when copying from an authoritative source.
- **Decimal comma** in docs prose (`2,5 Go`). Inside code blocks and env var values, keep the period (`2.5`).
- **Thousands separator:** narrow non-breaking space (`1 000`).
- **Dates:** `DD/MM/YYYY` in docs prose (`19/04/2026`). In frontmatter and technical contexts, use ISO (`2026-04-19`).
- **Times:** 24-hour clock in user-facing copy (`09 h 00`, `17 h 30`). Cron expressions and server logs keep their canonical format.
- **Headings are sentence case.** Capitalize only the first word and proper nouns — `## Concepts des agents`, not `## Concepts des Agents`.
- **Gerunds:** avoid untranslated English `-ing` forms. `Le monitoring` → `La supervision` when the sense is Tale's built-in Prometheus story. Keep `monitoring` only when it is a well-established tool-name loanword.
- **Inclusive forms:** prefer neutral nouns (`l’équipe`, `les personnes`) over `utilisateur·rice` in long-form docs. In space-tight UI, plain `utilisateur` is acceptable.
- **UI labels must match the product.** Before quoting a button or menu, grep `services/platform/messages/fr.json` to confirm the exact wording.
