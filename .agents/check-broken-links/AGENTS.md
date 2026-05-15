---
name: check-broken-links
description: The pre-commit verification skill for the docs. Runs the docs test suite (structural parity, terminology, prose-quality, loanword) and explains every check, what it catches, and how to fix failures. Use any time `docs/` or `services/docs/` changes.
---

# Check docs integrity

The docs test suite is the pre-merge gate for everything under [`docs/`](../../docs/) and [`services/docs/`](../../services/docs/). It runs a set of test files covering three layers: **structural** (mechanics), **terminology** (per-locale UI labels, pronouns, loanwords, German grammar), and **prose-quality** (opening, closing). Run it locally before every PR — it gates CI through `bunx turbo run test`.

This skill exists because a single failing test message is rarely enough to understand which rule was broken and where to find the contract. The sections below name every check, the contract it enforces, the failure mode it catches, and the fix.

## Usage

```bash
bun run --filter @tale/docs test
```

Run from any directory in the monorepo. The Vitest suite lives at [`services/docs/tests/`](../../services/docs/tests/) and walks the entire [`docs/`](../../docs/) tree.

For verbose output (one line per test, plus warning context):

```bash
cd services/docs && bun x vitest run --reporter=verbose
```

For a single test file:

```bash
cd services/docs && bun x vitest run tests/opening-paragraph.test.ts
```

---

## The structural layer (mechanics)

These checks fail when the repo is structurally inconsistent — they're the guardrails for "the page exists, the nav points at it, the locales mirror each other".

### `navigation-parity.test.ts`

**What it checks.** Every slug in [`docs/nav.json`](../../docs/nav.json) resolves to a real `.md` or `.mdx` file in `en`, `de`, and `fr`.

**What it catches.** A page added in EN but not yet translated. A page deleted in EN without removing the nav entry. A typo in a nav slug.

**How to fix.** Create the missing file in the listed locale, or remove the nav entry. The companion change in `docs/nav.json` is usually one line.

### `frontmatter.test.ts`

**What it checks.** Every page has a YAML frontmatter block with `title` and `description`.

**What it catches.** A new page that was committed without frontmatter, or with one missing field.

**How to fix.** Add the missing field. `title` is sentence-case; `description` is one sentence completing "This page is about…".

### `locale-parity.test.ts`

**What it checks.** For every page in `docs/en/`, the DE and FR mirrors keep the same heading outline (array of heading levels) and the same fenced-code-block count.

**What it catches.** A restructure in EN that didn't propagate to DE/FR. A heading added or removed in one locale but not the others. An accidental drop of a code block in translation.

**How to fix.** Read the EN source. Restructure the failing locale to match the EN outline. If the EN page is genuinely the one that should change (rare), update DE and FR in the same PR.

### `readme-parity.test.ts`

**What it checks.** `README.md`, `README.de.md`, `README.fr.md` keep the same structural shape — same heading outline, same number of sections.

**What it catches.** A README change in one language without the parallel updates.

**How to fix.** Mirror the change across all three READMEs.

---

## The terminology layer (per-locale)

These checks fail when a translated page contradicts the shipped UI or uses the wrong pronoun. They read [`.agents/terminology/GLOSSARY.json`](../terminology/GLOSSARY.json) as their source of truth.

### `terminology.test.ts`

**What it checks.** Two passes over every DE / FR / `de-CH` page:

1. **Formal-pronoun pass.** Rejects `Sie`/`Ihnen`/`Ihre`/`Ihrer`/`Ihres`/`Ihrem` in German and `vous`/`votre`/`vos` in French. (Sentence-initial `Sie` in DE is heuristically allowed because it's often the third-person plural `sie` capitalised — but in practice you should restructure to avoid the ambiguity.)
2. **UI-term pass.** Rejects English forms from `enToLocale[locale]` where the entry isn't a loanword. Example: `Customers` in a `docs/de/**` page is rejected (the shipped UI says `Kunden`); `Workflow` in a `docs/de/**` page is not flagged (it's an established loanword).

**What it catches.** Pronoun slips. UI-label drift between docs and the shipped product. Half-translated sentences (`Öffne **Settings > Members**`).

**How to fix.**

- Pronoun slip: rewrite to the informal form. Read [`TERMINOLOGY_DE.md`](../terminology/TERMINOLOGY_DE.md) §1 or [`TERMINOLOGY_FR.md`](../terminology/TERMINOLOGY_FR.md) §1 for the voice rule.
- UI-label drift: replace the English noun with the locale's UI form. Grep `services/platform/messages/<locale>.json` for the source of truth. If the UI form has changed, update the terminology files and `GLOSSARY.json` in the same PR.

### `loanword.test.ts`

**What it checks.** For every term in [`GLOSSARY.json`](../terminology/GLOSSARY.json) where the locale value differs from `en` (the Bucket-3 translate-must set), the test rejects the English form appearing in the page body (outside code fences, inline-code spans, and link URLs).

**What it catches.** The most common translation failure mode — leaving an English noun in DE/FR prose when a clean native equivalent exists. `Schicke deinen Request an die API.` → bug; should be `Anfrage`. `Configure ton Email Provider.` → bug; should be `fournisseur de courriel`.

**How to fix.** Use the native term from the glossary entry.

### `grammar-de.test.ts` (warn-only)

**What it checks.** Indefinite-article gender agreement for the closed list of high-frequency Tale nouns at `nounGenders.de` in [`GLOSSARY.json`](../terminology/GLOSSARY.json). For each noun with a known gender, the test scans for `einen`/`eine`/`einem`/`einer`/`eines` (with up to two adjectives in between) and flags mismatches.

**What it catches.** The class of error the audit caught: `einen einmaligen Warnung` (masculine accusative on a feminine noun) → should be `eine einmalige Warnung`. `dem Anfrage` → should be `der Anfrage`. `einen Konversation` → should be `eine Konversation`.

**How to fix.** Consult the noun-gender map at `nounGenders.de` and rewrite the article + adjective endings to agree. Definite-article cases (`der`/`die`/`das`/`dem`/`den`/`des`) are deliberately out of scope for v1 because they're ambiguous across case+number.

**Status:** warn-only. Promote to hard-fail once the rewrite sweep clears the existing corpus.

---

## The prose-quality layer (page shape)

These checks fail when a page's _shape_ doesn't meet the contract from [`.agents/docs/AGENTS.md`](../docs/AGENTS.md): a real opening, a real closing, no stubs.

### `opening-paragraph.test.ts`

**What it checks.** Every page (except files marked `kind: index` in frontmatter) opens with at least two sentences of prose between the frontmatter and the first sub-heading, list, table, or fenced code block.

**What it catches.** The one-sentence-then-list opening that the rewrite eliminated. `## Prerequisites` immediately after the frontmatter. A page that starts with a code block.

**How to fix.** Add a 2–4 sentence opening that answers _what / who / why_. The page-type playbooks in [`.agents/docs/AGENTS.md`](../docs/AGENTS.md) have a formula for each page type:

- **Feature reference**: `<Feature X> is <one-line definition>. <Audience> uses it for <use case>. <Reason it exists in the product>.`
- **Tutorial**: `<Outcome> requires <three or four moves>. This page walks all of them. <Prerequisites in one sentence>.`
- **Section overview**: `<Section X> is the part of Tale that does <Y>. <Audience> uses it for <Z>. <The order in which sub-pages should be read>.`

### `closing-paragraph.test.ts`

**What it checks.** Every page closes with a real recap, not a stub. Specifically:

1. The last sub-section heading is not one of the stub names (`Next`, `Next steps`, `See also`, `What's next`, `Weiter`, `Nächste Schritte`, `Siehe auch`, `Suite`, `Suivant`, `Étapes suivantes`, `Voir aussi`).
2. The body under the last sub-section is not a single line whose entire content is one markdown link.

**What it catches.** `## Next` / `## See also` headings with a one-line link body. The "feels cut off" failure mode.

**How to fix.** Rename the closing section for what it does. Pick from this menu (and add to it when needed):

- `## Build one` — concept page hands off to a build page.
- `## Where this fits` — reference page hands off to UI counterpart or related concept.
- `## Where this gets used` — tutorial lands a building block.
- `## When to reach for it` — feature that competes with similar features.
- `## Common shapes` — primitive that appears in many forms.
- `## What to read next` — start of a learning path.

The closing's body recaps the one thing the reader should remember (one paragraph, prose), then introduces the next page (one paragraph, prose with the link in context). The page-shape contract is in [`.agents/docs/AGENTS.md`](../docs/AGENTS.md) §3.

---

## When to run

- **After renaming, moving, or deleting a page.** Navigation parity, locale parity, and README parity all surface immediately.
- **After editing any heading.** Heading text → slug; anchor links to that heading break silently. The locale-parity test surfaces heading-outline drift across locales.
- **After editing [`docs/nav.json`](../../docs/nav.json).** Always.
- **After translating or rewriting a page in any locale.** All terminology + prose-quality checks.
- **Before opening a PR** that touches `docs/` or `services/docs/`. CI runs the same suite; failing locally avoids a round-trip.

## What to fix first when multiple tests fail

Run in this order. Each layer's failures often cascade out of the layer above it.

1. **Navigation parity** — fix every missing slug. Blocks everything else.
2. **Frontmatter** — two-second fix per page.
3. **Locale parity** — usually the deepest mechanical fix; restructure DE/FR to match the EN outline.
4. **Terminology** — pronoun slips, UI-label drift. Per-locale, mechanical.
5. **Loanword** — the bulk sweep script handles most.
6. **Opening / closing paragraph** — the prose-quality layer. Often the deepest content fix; rewrite to the page-shape contract.

## What this check does NOT cover

The test suite catches structural, terminology, and prose-quality issues but does **not** crawl every internal `[link](/path)` reference in page body text — only navigation slugs and translation parity. When you move a page, also grep the monorepo for inbound links from outside the nav (other doc pages, app code, README files).

Pitfalls the suite cannot catch — review them by hand:

- **Anchor with stripped umlaut or accent.** Slug generation preserves unicode, so a link `#schema-kompatibilitat-und-rollback` will not match a heading `## Schema-Kompatibilität und Rollback` — the correct anchor is `#schema-kompatibilität-und-rollback`. Fix the link, not the heading.
- **Heading with parentheses or dots.** Slug generation for `## Foo (bar)` or `## Step 1.2 — bootstrap` is not obvious. Read the heading anchor from the rendered page once, then reference that slug.
- **Link in a non-English file missing its locale prefix.** A link in `docs/de/**` to `/self-hosted/foo` 404s — it has to be `/de/self-hosted/foo`.
- **Tone drift inside passing prose.** The loanword test catches untranslated nouns; it does not catch a translation that is structurally German but reads bureaucratic (`Wird gespeichert…` passes lint but fails review). Read the [`docs`](../docs/AGENTS.md) and [`terminology`](../terminology/AGENTS.md) skills for the voice rules and review your prose against them.
- **Calqued idioms.** The loanword test catches `Header` → `Kopfzeile`, but not `Vertrauenshaltung` for `Trust posture`. Read it aloud — if it sounds like a translation, restructure.
- **Half-translated compounds beyond known UI terms.** The tests catch `Pull Anfrage` only when both halves are tracked terms; outside that, reviewers spot the language-switch-mid-word.
- **Definite-article gender slips in DE.** The grammar test covers indefinite articles only. `dem Anfrage` is caught (the new test's edge case); `der Warnung` in a sentence where dative case doesn't apply is not.
- **A section overview that's still a stub-with-links.** Passes opening/closing tests but fails the section-overview shape contract from [`docs/AGENTS.md`](../docs/AGENTS.md). Read by hand.

---

## How to extend the suite

The test infrastructure lives at [`services/docs/tests/`](../../services/docs/tests/) with a shared helpers module at [`services/docs/tests/_helpers.ts`](../../services/docs/tests/_helpers.ts) that exposes:

- `CONTENT_ROOT` — the absolute path of `docs/`.
- `walkDocs()` — every `.md`/`.mdx` path under `docs/`, relative to `CONTENT_ROOT`.
- `discoverLocales()` — every top-level locale subdirectory under `docs/` (regex `^[a-z]{2}(?:-[A-Z]{2})?$`).
- `localeOf(relPath)` — the locale of a content-relative path.

Adding a new check is two files: a new `*.test.ts` under `services/docs/tests/`, and (optionally) a new section in `GLOSSARY.json` if the check needs structured input. Follow the pattern of `loanword.test.ts` — read the glossary, walk localised pages, mask code fences and inline code, scan for the pattern, accumulate findings, fail the assertion with a formatted message.

To extend `translateBucket`: add the `{ en, native, rationale }` triple to `GLOSSARY.json` under the right locale, update the corresponding `TERMINOLOGY_<LOCALE>.md` table, and rerun the test. To graduate an entry from `translateBucket` to `enToLocale` (so the existing `terminology.test.ts` catches it instead), move the pair; the two tests are functionally equivalent.

---

## Quick reference — every check on one line

| Test                        | Layer       | What it enforces                                                                           |
| --------------------------- | ----------- | ------------------------------------------------------------------------------------------ |
| `navigation-parity.test.ts` | structural  | Nav slugs resolve to real files in en/de/fr.                                               |
| `frontmatter.test.ts`       | structural  | Every page has `title` and `description`.                                                  |
| `locale-parity.test.ts`     | structural  | DE/FR mirror the EN heading outline and code-block count.                                  |
| `readme-parity.test.ts`     | structural  | READMEs in en/de/fr stay structurally in sync.                                             |
| `terminology.test.ts`       | terminology | Informal pronouns; UI-label terms match the shipped UI per locale.                         |
| `loanword.test.ts`          | terminology | Translate-bucket English nouns are translated in DE/FR.                                    |
| `grammar-de.test.ts`        | terminology | German indefinite-article gender agreement on the closed `nounGenders.de` set (warn-only). |
| `opening-paragraph.test.ts` | prose       | Every page opens with ≥ 2 sentences of prose.                                              |
| `closing-paragraph.test.ts` | prose       | Every page closes with a real recap, not a `## Next` stub.                                 |
