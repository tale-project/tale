# Tale docs — contributor guide

Rules for writing and maintaining the Mintlify documentation under [`docs/`](./). These rules are binding on every change that touches a page in the tree, supersede the shorter note in the root [`AGENTS.md`](../AGENTS.md), and are loaded automatically by agents working inside `docs/`.

## The one rule

Documentation is part of every shipping change, not a follow-up. If a pull request alters what users see, configure, or interact with — a feature, a setting, an environment variable, an API response, a CLI flag, a removal — the same PR updates the docs in every base locale (`en`, `de`, `fr`). Regional variant trees (today `de-CH`; more may come) are sparse: only override pages whose wording genuinely differs from the base. Code without docs is incomplete work and does not merge.

Everything below is mechanics for making that rule easy to follow.

## Where things live

| Path                                 | Role                                                                                                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/**/*.md`                       | English pages. The source tree.                                                                                                                      |
| `docs/de/**/*.md`, `docs/fr/**/*.md` | Translated mirrors. Same tree shape as English.                                                                                                      |
| `docs/<xx-YY>/**/*.md`               | Regional variant overrides (today `de-CH`). Sparse — only files that genuinely differ from the base. Missing files fall back to the base, then `en`. |
| [`docs/docs.json`](docs.json)        | Mintlify navigation. Edited alongside every page addition/rename/deletion.                                                                           |
| [`docs/scripts/`](scripts/)          | Bun + TypeScript tooling (frontmatter and terminology linters, broken-link checker bindings).                                                        |
| [`docs/images/`](images/)            | Assets. Referenced from all locales.                                                                                                                 |

Mintlify Cloud builds straight from the committed repo state. None of our scripts run on their side — if it is not in git at merge time, it does not exist on the site.

## Taxonomy

Docs are organized on two axes. The first axis is the top-level Mintlify tab; the second axis applies only inside the Self-hosted tab, where readers split by platform role.

### Top-level tabs

| Directory      | Tab             | Audience                                                                                                                                         |
| -------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cloud/`       | **Cloud**       | Managed-SaaS readers. Onboarding, billing, data residency (Switzerland/EU), trust and compliance, Cloud-specific admin.                          |
| `self-hosted/` | **Self-hosted** | Operators running Tale on their own infrastructure, and end users of those instances, split by role.                                             |
| `platform/`    | **Platform**    | Product feature reference. Identical for Cloud and Self-hosted. **The single source of truth for every feature** — Cloud and role pages link in. |
| `develop/`     | **Develop**     | API consumers, webhook integrators, SDK users, source contributors.                                                                              |
| `legal/`       | (footer)        | Privacy policy, terms of service, DPA. `noindex: true` in frontmatter.                                                                           |

### Self-hosted sub-structure

Operators and end users share the tab. They live in different subdirectories so each role can be navigated in isolation.

| Subdirectory     | Audience                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| `install/`       | First-time installation — Linux, Docker Compose, Kubernetes, TLS.                                   |
| `cli/`           | The `tale` CLI — commands, install, troubleshooting.                                                |
| `configuration/` | Environment variables, retention, providers, storage, networking. Authoritative reference pages.    |
| `operate/`       | Running a live instance — deployments, observability, backups, upgrades, advisories, release notes. |
| `admin/`         | Owner and Admin workflows — members, roles, teams, auth, branding, governance, usage analytics.     |
| `developer/`     | Developer-role tasks — agents, automations, integrations, API keys, webhooks.                       |
| `editor/`        | Editor-role tasks — knowledge base, conversations, approvals, products/customers/vendors.           |
| `member/`        | Member-role tasks — chat, read-only knowledge and conversations, preferences.                       |

### Placement rules

- **Feature reference goes under `platform/`.** One canonical page per feature. Cloud and role pages link in; they do not re-document.
- **Deployment-only content goes under its flavour tab.** Install docs only apply to Self-hosted; billing only applies to Cloud.
- **Role pages own the task, platform pages own the concept.** An Editor's how-to on uploading a document lives at `self-hosted/editor/knowledge-base.md`; the full walkthrough lives at `platform/workspace/knowledge-base.md`. Never copy the walkthrough into a role page — link to it.
- **`platform/` is the UI. System access lives under `self-hosted/`.** Anything a user — including admins — does inside the running app (click a button, fill in a form, toggle a setting in **Settings > …**) goes under `platform/`. Anything that requires filesystem access, config files (`TALE_CONFIG_DIR/**`), environment variables, CLI commands, SOPS (the encrypted-secrets tool used for `*.secrets.json` files), Docker, or server-side deployment goes under `self-hosted/configuration/` or `self-hosted/operate/`. When the same feature has both a UI path and a config-file path, `platform/` describes **only** the UI path and links to the self-hosted reference for the file form. Never paste a JSON config snippet, a `cp examples/... $TALE_CONFIG_DIR/...` command, or an env-var table into a `platform/` page — those contradict the Cloud reader's reality and belong one tab over.
- **Owner has no directory.** Owner is Admin plus a small set of org-lifecycle actions, which live in one page: `self-hosted/admin/organization-lifecycle.md`.
- **Disabled has no docs.** A Disabled account cannot access the product.
- **Cloud has no role split.** Cloud readers consume `platform/` directly; role permissions are covered by the shared canonical matrix at `self-hosted/admin/members-and-roles.md` (linked from Cloud admin pages).

Never mix audiences in one page. If a concept genuinely spans audiences, write two short pages that cross-link, not one hybrid page.

#### Worked example — UI vs system content

A provider has two surfaces. Both are legitimate, but they belong in different tabs:

| Aspect                                                                       | Belongs in                                                                 |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| What **Settings > Providers** shows, how to add/edit/delete a provider there | `platform/admin/providers.md`                                              |
| What model tags mean (`chat`, `vision`, `transcription`) — a product concept | `platform/admin/providers.md`                                              |
| The JSON file layout, `defaults.*` keys, `cost.centsPerAudioMinute`          | `self-hosted/configuration/providers.md` (or wherever the file form lives) |
| `cp examples/providers/openai.json $TALE_CONFIG_DIR/providers/`              | `self-hosted/configuration/providers.md`                                   |
| `TALE_CONFIG_DIR` value per deployment flavour                               | `self-hosted/configuration/environment-reference.md`                       |
| SOPS encryption of `*.secrets.json`                                          | `self-hosted/configuration/providers.md`                                   |

A Cloud reader lands on `platform/admin/providers.md`, sees a `cp` command, and is confused — they have no shell on the instance. Keep the platform page pure: describe the UI, link out for the file form.

## Writing style

Every page is judged against the same bar: a reader who lands cold from a search result should come away with the concept _and_ the next action they can take. Thin pages that only list bullets fail that bar.

### Mechanics

- **Frontmatter is required.** Every page has `title` and `description`. Legal pages also carry `noindex: true`.
- **Filenames are dash-case.** `api-reference.md`, never `api_reference.md` or `APIReference.md`.
- **Headings are sentence case.** `## Agent concepts`, not `## Agent Concepts`.
- **One topic per file.** When a page drifts into a second subject, split it.
- **Code blocks always carry a language identifier.** ` ```bash `, ` ```typescript `, ` ```json ` — never a bare ` ``` `.
- **Tables stay aligned.** Pipes line up, padding matches. Run `bun run --filter @tale/docs format` (oxfmt) before committing.
- **Imperative voice for instructions.** "Run `tale deploy`" — never "You can run `tale deploy`".
- **Link to sources of truth, never copies.** If an env var is documented in `configuration/environment-reference.md`, link to it; do not re-describe the variable inline.
- **No status chatter.** `Updated:`, `New in v1.6:`, `TODO:` have no place in prose. Release notes and git history cover that.
- **Use Mermaid for architecture and flow diagrams.** Label nodes in full sentences; size diagrams to fit on one screen.

### Depth and voice

Short is good. Fragmentary is not. A page that opens with one sentence and a bullet list forces the reader to assemble the mental model themselves, and leaves non-obvious "why" decisions invisible.

- **Every page opens with a 2–4 sentence concept paragraph** that explains what the feature is, who it is for, and why it exists. Single-sentence intros are a bug.
- **Explain _why_, not only _what_.** `Run tale deploy to apply the new config` tells the reader what to type; `Run tale deploy to trigger a blue-green rollout — the old container keeps serving traffic until the new one passes its health check` tells them why the command is safe in production.
- **Paragraphs beat bullet lists for prose.** Reserve bullets for parallel items (commands, env vars, options). A bullet list of three items explaining a concept is almost always better as a paragraph.
- **Short lists are prose.** Fewer than five items? Write a sentence. Tables and bullets are for five or more parallel items.
- **Define every domain term on first use per page** (`The composer is the chat input at the bottom of the screen`). After the first definition, use the term freely.

### Depth example

The rule in practice:

> ## Add a website
>
> Paste the URL. Click **Crawl**. Wait for the pages to index.

Rewritten to meet the bar:

> ## Add a website
>
> Adding a website pulls every page under a URL into the knowledge base so agents can answer questions using that content. Crawling runs in the background and can take minutes or hours depending on site size; the tab does not need to stay open.
>
> Paste the URL in the composer, open the website panel, and start a crawl. Crawl schedules and refresh cadence are covered separately in [Website crawling](/platform/knowledge/crawling).

## Internationalization

### Locales we publish

Three base locales, each with full coverage: `en`, `de`, `fr`. English lives at the `docs/` root; German and French live under `docs/de/` and `docs/fr/`. Regional variants layer on top under `docs/<xx-YY>/` — today only `docs/de-CH/` exists, but the loader generalizes: any new variant directory is picked up automatically. Variant trees are sparse — pages that don't override fall through to the base, then `en` (chain computed in [`services/docs/lib/content/loader.ts`](lib/content/loader.ts) from `ALL_LOCALES`).

### Lifecycle rules

When you **add** a page:

1. Create the English file at `docs/<path>.md`.
2. Create translated mirrors at `docs/de/<path>.md` and `docs/fr/<path>.md`.
3. Add the page to every `navigation.languages` block in [`docs/docs.json`](docs.json), using locale-prefixed paths.
4. Run `bun run --filter @tale/docs format` to normalize Markdown (tables, list spacing, etc.).
5. Commit the locale files and `docs.json` together.

When you **rename or move** a page:

1. Rename the file in every locale tree.
2. Update the `pages` entry in every `navigation.languages` block.
3. Grep the repo for the old path (at minimum [`README.md`](../README.md) and the sibling locales) and update references.

When you **delete** a page:

1. Delete from every locale tree.
2. Remove from every `navigation.languages` block.

### Editing rules

- **Locale-prefixed internal links** in non-English files. A link in `docs/de/build/agents/create.md` points to `/de/build/agents/concepts`, not `/build/agents/concepts`.
- **Translate every frontmatter value.** Both `title` and `description`. A German page with an English title is a bug.
- **Code and diagram syntax stays put.** Inside fenced code, `<CodeGroup>`, and Mermaid DSL, translate only human-readable node labels. Never the arrows, `participant` keywords, or block structure.
- **Brand names never translate.** Tale, Convex, Mintlify, OpenRouter, Claude, GitHub, Slack, Gmail, Outlook, Shopify — all stay as-is in every locale.
- **Keep anchors stable.** Mintlify slugs headings; when you change a heading in one locale, update every locale that links to the anchor, since the generated slug differs per locale.

### Translation style

- [`.agents/TERMINOLOGY.md`](../.agents/TERMINOLOGY.md) — cross-locale rules: length parity, tone, plural handling, placeholder preservation.
- [`.agents/TERMINOLOGY_EN.md`](../.agents/TERMINOLOGY_EN.md) — English source forms.
- [`.agents/TERMINOLOGY_DE.md`](../.agents/TERMINOLOGY_DE.md) — German base.
- [`.agents/TERMINOLOGY_DE_CH.md`](../.agents/TERMINOLOGY_DE_CH.md) — Swiss German overrides (mainly `ß` → `ss` and a few lexical shifts).
- [`.agents/TERMINOLOGY_FR.md`](../.agents/TERMINOLOGY_FR.md) — French base.
- Add a `TERMINOLOGY_<LOCALE>.md` for any new regional variant.

Style rules in short:

- **Informal form** everywhere — `du` in German, `tu` in French. Never `Sie` or `vous`.
- **Sentence case** in headings in every locale.
- **ICU placeholders preserved exactly** — `{count, plural, ...}`, `{field}`. Rare in docs; flag any you see broken.

### Translate meaning, not words

English-to-German and English-to-French are not word-substitution problems. Sentence structure, idiom, and noun choice all differ across languages. A mechanical, word-for-word render produces sentences native readers reject — even when every individual word is correct.

Concrete rules, every one of which has failed in this repo before:

- **Never calque English metaphors.** `Published certification story` was once rendered into German as _"eine veröffentlichte Zertifizierungsgeschichte"_ — literally "a published history of certifications," a phrase no German speaker would write. The natural rendering names the certifications: _"ISO 27001, SOC 2 Type II und DSGVO-Konformität"_. When English reaches for a figurative noun (`story`, `journey`, `posture`, `surface`), translate its _meaning_, not the noun.
- **Don't borrow English when the target language owns a native word.** `Surface opérationnelle` is an Anglicism; French uses _l'exploitation_. `Operative Seite` is awkward German; prefer _der Betrieb_. Verify the loanword actually exists in the target language with your intended meaning — many do not.
- **Restructure sentences to fit the target language.** German compound nouns and verb-final subordinate clauses; French preference for relative clauses over stacked noun phrases. If English uses three short clauses and the natural German equivalent is one longer sentence, write the longer sentence.
- **Prefer concrete nouns to abstract ones.** English tech prose leans on abstractions (`posture`, `story`, `flow`); most readers in the target language prefer the concrete thing. _Trust posture_ → _unsere Zertifizierungen_ / _nos certifications publiques_.
- **Read the paragraph aloud.** If it sounds like a translation, rewrite it. A good translation reads as if originally authored in the target language.
- **When in doubt, drop the figure of speech.** Stating the underlying fact plainly beats a literal rendering that reads as machine-generated.

### UI terms must match the locale's shipped label

Every user-facing term a doc page names — a button, a menu item, a panel title, a feature, a knowledge-base entity — **must match the string the UI actually displays in that locale, verbatim**. The source of truth is `services/platform/messages/<locale>.json`. If the German UI shows _Kunden_ and your page writes `Customers`, the reader cannot find what you point at. Mixed forms (half English, half translated) in the same sentence are the most common bug — do not write them.

Rules:

1. **`services/platform/messages/<locale>.json` is the single source of truth. Terminology files document it; docs quote it.** Before writing a UI term in a translated page, grep the locale JSON for its key (`navigation.*`, `settings.*.title`, `<entity>.title`, `chat.*`). If the UI string and the terminology file disagree, the UI wins — update the terminology file to match, then the doc. Never pick the English term because it "reads better".
2. **Don't carry English over as a loanword unless the UI itself does.** `Canvas` stays `Canvas` in German (UI shows `Canvas`) but becomes `Canevas` in French (UI shows `Canevas`). The [`.agents/TERMINOLOGY_<LOCALE>.md`](../.agents/) tables are the authoritative mapping — update them if the UI changes.
3. **Code identifiers stay English.** CLI flags (`tale deploy --detach`), env vars (`TALE_CONFIG_DIR`), file paths (`docker-compose.yml`), i18n keys (`chat.canvas.title`), API paths (`POST /api/v1/documents`) are international and never translate. Inside a sentence in a translated page, quote code as code — do not paraphrase the path.
4. **Role names stay English in every locale.** `Owner`, `Admin`, `Developer`, `Editor`, `Member`, `Disabled` — because the UI ships them that way. Generic _members of a team_ becomes `Mitglieder` / `membres`; the capital-M role stays `Member`.
5. **Parenthetical lists translate too.** When an English page writes `(Products, Customers, Vendors)` as examples, the German mirror writes `(Produkte, Kunden, Lieferanten)` and the French mirror writes `(Produits, Clients, Fournisseurs)`. Don't leave the English list behind — it contradicts the UI the reader just opened.
6. **Navigation paths translate segment by segment.** `Settings > Members` becomes `Einstellungen > Mitglieder` / `Paramètres > Membres`. Writing `Einstellungen > Members` is a bug: the reader sees `Einstellungen` in the sidebar but no `Members` entry.

#### Canonical UI label reference

Quote these values verbatim in every translated page. If a term you need is missing from the table, grep the locale JSON — then add the entry to the matching [`.agents/TERMINOLOGY_<LOCALE>.md`](../.agents/) file so the next edit is cheap.

| English          | German (`de`)     | French (`fr`)           | Source key                                               |
| ---------------- | ----------------- | ----------------------- | -------------------------------------------------------- |
| Customers        | Kunden            | Clients                 | `customers.title`                                        |
| Products         | Produkte          | Produits                | `products.title`                                         |
| Vendors          | Lieferanten       | Fournisseurs            | `vendors.title`                                          |
| Documents        | Dokumente         | Documents               | `documents.title`                                        |
| Websites         | Websites          | Sites web               | `websites.title`                                         |
| Conversations    | Konversationen    | Conversations           | `navigation.conversations`                               |
| Knowledge        | Wissen            | Base de connaissances   | `navigation.knowledge`                                   |
| Knowledge base   | Wissensdatenbank  | Base de connaissances   | terminology                                              |
| Automations      | Automatisierungen | Automatisations         | `navigation.automations`                                 |
| Integrations     | Integrationen     | Intégrations            | `navigation.integrations`                                |
| Teams            | Teams             | Équipes                 | `navigation.teams`                                       |
| Agents           | Agents            | Agents                  | `navigation.agents`                                      |
| MCP servers      | MCP-Server        | Serveurs MCP            | `navigation.mcpServers`                                  |
| Providers        | KI-Anbieter       | Fournisseurs IA         | `navigation.providers`                                   |
| API keys         | API-Schlüssel     | Clés API                | `navigation.apiKeys`                                     |
| Branding         | Branding          | Image de marque         | `navigation.branding`                                    |
| Governance       | Richtlinien       | Gouvernance             | `navigation.governance`                                  |
| API docs         | API-Dokumentation | Documentation API       | `navigation.apiDocs`                                     |
| Account          | Konto             | Compte                  | `navigation.account`                                     |
| Logs             | Protokolle        | Journaux                | `navigation.logs`                                        |
| Organization     | Organisation      | Organisation            | `navigation.organization`                                |
| Settings         | Einstellungen     | Paramètres              | `navigation.settings`                                    |
| Members (entity) | Mitglieder        | Membres                 | terminology — `Member` as a role stays English           |
| Approvals        | Genehmigungen     | Approbations            | terminology                                              |
| Chat with AI     | Chat mit KI       | Discuter avec l'IA      | `navigation.chatWithAI`                                  |
| Canvas           | Canvas            | Canevas                 | `chat.canvas.title`                                      |
| Composer         | Composer          | Composeur               | `composer.*`                                             |
| Prompt library   | Prompt-Bibliothek | Bibliothèque de prompts | `chat.promptLibrary`                                     |
| Arena Mode       | Arena-Modus       | Mode Arène              | `chat.arena.title`                                       |
| Research plan    | Recherche-Plan    | Plan de recherche       | `todoList.title`                                         |
| Thread (prose)   | Konversation      | Conversation            | terminology — keep `Thread` only in code/API identifiers |

Worked examples:

| Scenario                                             | Wrong                                         | Right                                                                 |
| ---------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------- |
| German page listing structured-data entities         | "Importiere **Products, Customers, Vendors**" | "Importiere **Produkte, Kunden, Lieferanten**"                        |
| French page listing structured-data entities         | "Importe **Products, Customers, Vendors**"    | "Importe **Produits, Clients, Fournisseurs**"                         |
| German page naming a settings sub-page               | "Gehe zu **Einstellungen > Members**"         | "Gehe zu **Einstellungen > Mitglieder**"                              |
| German page naming the conversations inbox           | "**Conversations** ist das Kunden-Inbox"      | "**Konversationen** ist der Kunden-Posteingang"                       |
| German page naming the canvas feature                | "Öffne das **Canvas** Panel"                  | "Öffne das **Canvas**" (matches `chat.canvas.title`)                  |
| French page naming the canvas feature                | "Ouvre le panneau **Canvas**"                 | "Ouvre le **Canevas**" (matches `chat.canvas.title`)                  |
| German page naming the prompt library                | "Öffne die **Prompt Library**"                | "Öffne die **Prompt-Bibliothek**" (matches `chat.promptLibrary`)      |
| French page naming the prompt library                | "Ouvre la **Prompt Library**"                 | "Ouvre la **Bibliothèque de prompts**" (matches `chat.promptLibrary`) |
| German page naming the research plan pane            | "Öffne die **Todo-Liste**"                    | "Öffne den **Recherche-Plan**" (matches `todoList.title`)             |
| French page naming the research plan pane            | "Ouvre la **Todo list**"                      | "Ouvre le **Plan de recherche**" (matches `todoList.title`)           |
| German page naming the conversation starters feature | "## Conversation Starter"                     | "## Gesprächseinstiege" (matches the agent UI)                        |

When unsure, grep the locale JSON:

```bash
grep -F '"Kunden"' services/platform/messages/de.json
grep -E '"(title|label)":' services/platform/messages/fr.json | grep -i client
```

Before opening a PR that touches a translated page, grep your own diff for English UI nouns (`Customers`, `Products`, `Vendors`, `Documents`, `Websites`, `Conversations`, `Members`, `Settings`, `Approvals`, `Knowledge Base`, `Conversation Starters`, `Prompt Library`, `Todo List`). Any hit in `docs/de/` or `docs/fr/` that is not inside a fenced code block, an i18n key, a URL, or an English brand name is a bug.

## Workflow

### Local preview

```bash
cd docs
bun install        # first time only
bun run dev        # predev (table formatter) + mintlify dev
```

Click through the language switcher on every section on every locale. A 404 in any locale means a missing file or a stale `docs.json` entry.

### Before every PR

All three must pass:

```bash
bun run --filter @tale/docs format         # oxfmt: normalize Markdown and JSON
bun run --filter @tale/docs lint            # frontmatter + terminology + Mintlify broken-link check
```

### Navigation parity

Every `pages` entry across the three `navigation.languages` blocks must resolve to a real `.md` / `.mdx` file. A quick drift check:

```bash
cd docs && node -e "
const j = JSON.parse(require('fs').readFileSync('docs.json', 'utf8'));
const fs = require('fs');
function collect(n, o=[]) { for (const e of n) typeof e === 'string' ? o.push(e) : collect(e.pages, o); return o; }
for (const l of j.navigation.languages) for (const p of collect(l.groups)) {
  if (!fs.existsSync(p + '.md') && !fs.existsSync(p + '.mdx')) console.log('MISSING', l.language, p);
}
"
```

## Common pitfalls

- **Forgetting a `navigation.languages` block.** A file on disk but not in `docs.json` is invisible in that locale.
- **Translated anchors that don't match their target.** `/de/bar#some-heading` only works if `docs/de/bar.md` has a heading whose German slug is `some-heading`.
- **External links cast as internal.** `](/external-site)` is treated as in-site and 404s. External links are fully qualified (`https://…`).
- **Committing without running `format`.** Run it first so reviewers don't wade through alignment or whitespace noise.
- **Duplicating env var or API reference content.** The reference pages are authoritative — link to them.
