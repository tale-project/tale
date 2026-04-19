# Documentation guidelines

Rules for writing and maintaining the Mintlify documentation under `docs/`. These supersede the shorter note in the repository-root [`AGENTS.md`](../AGENTS.md) and are loaded automatically by agents working inside `docs/`.

## The non-negotiable rule

Documentation is part of every change, not a follow-up. If a pull request changes what users see, configure, or interact with — a feature, a setting, an environment variable, an API, a CLI flag, a removal — the same PR updates the docs in every base locale (`en`, `de`, `fr`) and regenerates the variant locales. Code without up-to-date docs is incomplete work and should not be merged.

## Where docs live

- Pages: Markdown files under `docs/`.
- Navigation: [`docs/docs.json`](docs.json). Mintlify reads this file to build the site.
- Scripts: [`docs/scripts/`](scripts/) (Bun + TypeScript).
- Assets: [`docs/images/`](images/).

The site is published to Mintlify Cloud directly from the committed repo state — Mintlify does not run any of our scripts. Everything the site needs must be in git at merge time.

## Taxonomy: write for a persona, not a feature

Docs are organized by the reader, not by the feature. When you add a page, place it where its intended audience looks first:

| Directory | Audience |
| --- | --- |
| `docs/` root (`index.md`) | landing page and persona entry points |
| `docs/use/` | end users — Members and Editors using Chat, Workspace, Approvals, Preferences |
| `docs/build/` | Editors and Developers configuring agents, automations, integrations, structured knowledge |
| `docs/admin/` | Owners and Admins managing members, teams, providers, branding, governance, analytics |
| `docs/operate/` | infrastructure operators — deployment, configuration, observability, security, release notes |
| `docs/develop/` | API consumers and source contributors |
| `docs/legal/` | privacy policy, terms of service, DPA |

Never mix audiences in one page. End-user guidance does not belong under `operate/` or `develop/`; operator runbooks do not belong under `use/` or `build/`. If a concept genuinely spans audiences, write two short focused pages that cross-link, not one mixed page.

## Writing style

- **Frontmatter is required.** Every page has `title` and `description`. Legal pages must also include `noindex: true`.
- **Filenames are dash-case.** `api-reference.md`, not `api_reference.md` or `APIReference.md`.
- **Sentence case in headings.** `## Agent concepts`, not `## Agent Concepts`.
- **One topic per file.** Split rather than append when a page starts covering two things.
- **Cross-link, don't duplicate.** If you're about to repeat content from another page, link to it instead.
- **Code blocks always have a language identifier.** `` ```bash ``, `` ```typescript ``, `` ```json ``, etc. — never bare `` ``` ``.
- **Use Mermaid for architecture and flow diagrams.** Label nodes in full sentences; keep diagrams short enough to read without scrolling.
- **Align markdown tables.** Pipes lined up, padding consistent. Unreadable tables annoy editors and reviewers.
- **Link to sources of truth, not copies.** Prefer `[Environment reference](/operate/configuration/environment-reference)` over re-documenting env vars inline.
- **Imperative voice for instructions.** "Run `tale deploy`" not "You can run `tale deploy`".
- **No status chatter in prose.** Don't write "Updated:", "New in v1.6:", "TODO:" — use release notes or git history.

## Internationalization

### Locales we publish

Six locales, all with full coverage: `en`, `de`, `de-AT`, `de-CH`, `fr`, `fr-CH`. Mintlify does not fall back across languages — a missing translation becomes a 404 in that locale's navigation.

### Base locales vs regional variants

**Base locales** — `en` (at the `docs/` root), `de` (at `docs/de/`), `fr` (at `docs/fr/`). These are written and edited by hand.

**Regional variants** — `de-AT`, `de-CH`, `fr-CH`. These are **generated** from their base by [`scripts/generate-locale-variants.ts`](scripts/generate-locale-variants.ts):

```text
de  ──►  de-AT, de-CH
fr  ──►  fr-CH
```

For a variant-specific divergence (Swiss legal notice, Austrian spelling preference), add a file-level override at `docs/.locale-overrides/<variant>/<same-path>.md`. The generator uses the override in place of the base file.

### When you add a page

1. Create the file in the English tree at `docs/<path>.md`.
2. Create translated mirrors at `docs/de/<path>.md` and `docs/fr/<path>.md`.
3. Add the page to the `pages` array inside **every** `navigation.languages` block in `docs/docs.json` (all six locales) using locale-prefixed paths.
4. Run `bun run --filter @tale/docs generate:variants` — this produces `de-AT`, `de-CH`, and `fr-CH` copies.
5. Stage and commit the base-locale files, the variant dirs, and `docs.json` together.

### When you rename or move a page

1. Rename the file in every base tree (`en`, `de`, `fr`).
2. Update the `pages` entry in every `navigation.languages` block in `docs/docs.json`.
3. Grep the codebase for the old path (`README.md` at minimum) and update references.
4. Regenerate variants and commit.

### When you delete a page

1. Delete from every base tree.
2. Remove from every `navigation.languages` block in `docs/docs.json`.
3. Regenerate variants and commit.

### Editing rules

- **Never edit `docs/de-AT/`, `docs/de-CH/`, or `docs/fr-CH/` by hand.** These directories are wiped and rewritten on every `bun run dev` or `bun run build`. Edit the base locale (`de` or `fr`) or an override file.
- **Always regenerate variants before committing.** Run `bun run --filter @tale/docs generate:variants` after any base-locale change and stage the result. Stale variants = wrong content for AT / CH readers.
- **Rewrite internal links to include the locale prefix** in non-English files. A link in `docs/de/build/agents/create.md` points to `/de/build/agents/concepts`, not `/build/agents/concepts`. The generator rewrites `/de/` → `/de-AT/` etc. automatically for variants.
- **Translate frontmatter values** — both `title` and `description`. A German page titled `AI-assisted development` is a bug.
- **Leave code and diagram syntax alone** — inside `` ``` `` blocks, inside `<CodeGroup>` tags, and inside Mermaid `graph`/`sequenceDiagram` DSL. Only translate Mermaid node labels (the prose inside node shapes), not the arrows or block structure.
- **Never translate brand names.** Tale, Convex, Mintlify, OpenRouter, Claude, GitHub, Slack, etc.
- **Keep anchor links stable.** If you change a heading in the English file, the generated slug changes, and any link to `#old-slug` breaks. Update every translated locale's heading (so its slug matches the target's locale-specific heading) when you rename a section.

### Translation style

- Read [`.agents/TERMINOLOGY.md`](../.agents/TERMINOLOGY.md) for rules that apply to every locale (length parity, tone, plural rules, placeholder handling).
- Read the base-locale file before translating or reviewing a page: [`.agents/TERMINOLOGY_DE.md`](../.agents/TERMINOLOGY_DE.md) for German, [`.agents/TERMINOLOGY_FR.md`](../.agents/TERMINOLOGY_FR.md) for French, [`.agents/TERMINOLOGY_EN.md`](../.agents/TERMINOLOGY_EN.md) when authoring English.
- When you write a **variant override** under `docs/.locale-overrides/<variant>/`, also read the matching variant file — it lists only the delta from the base:
  - `de-AT`: [`.agents/TERMINOLOGY_DE_AT.md`](../.agents/TERMINOLOGY_DE_AT.md) (months like "Jänner")
  - `de-CH`: [`.agents/TERMINOLOGY_DE_CH.md`](../.agents/TERMINOLOGY_DE_CH.md) (no "ß", CHF currency, apostrophe thousands separator)
  - `fr-CH`: [`.agents/TERMINOLOGY_FR_CH.md`](../.agents/TERMINOLOGY_FR_CH.md) (septante / nonante, CHF, point decimal, apostrophe thousands)
- **Informal form** throughout: "du" in German, "tu" in French. Never "Sie" or "vous".
- **Sentence case** for headings in every locale.
- **Preserve ICU placeholders** exactly if any appear (`{count, plural, ...}`, `{field}`). Docs usually don't have them, but flag if you see one broken.

## Workflow and verification

### Local preview

```bash
cd docs
bun install       # first time only
bun run dev       # runs predev (variant generation) + mintlify dev
```

Click through the language switcher for every section on every locale. A 404 in any locale means a missing base file or a stale `docs.json` entry.

### Lints and checks

```bash
bun run --filter @tale/docs lint           # frontmatter lint across all 294 files
bun run --filter @tale/docs generate:variants  # regenerate variants; should be a no-op after the first run in a clean tree
cd docs && bun run broken-links            # Mintlify's built-in link checker
```

All three must pass before you open a PR.

### Navigation parity

Every `pages` entry across the six `navigation.languages` blocks must resolve to a real `.md` / `.mdx` file. A quick script to catch drift:

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

- **Editing variants directly.** The change survives until the next `bun run dev`, then silently vanishes.
- **Forgetting a `navigation.languages` block.** A page in the filesystem but not in docs.json is invisible in that locale.
- **Translated anchors that don't match the target.** In `docs/de/foo.md`, a link to `/de/bar#some-heading` only works if `docs/de/bar.md` actually has a heading that slugs to `some-heading` in German.
- **External links cast as internal.** `](/external-site)` is treated as an in-site link and 404s. External links must be fully qualified (`https://…`).
- **Committing without regenerating.** CI will (eventually) fail a parity check; spare yourself the round trip by running `generate:variants` before every commit that touches `docs/`.
- **Duplicating env var or API reference content.** Those pages are authoritative; link to them instead.
