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
cd services/docs && bun x vitest run tests/structure-opening.test.ts
```

---

## The structural layer (mechanics)

These checks fail when the repo is structurally inconsistent — they're the guardrails for "the page exists, the nav points at it, the locales mirror each other".

### `walk.test.ts`

**What it checks.** Sanity — the walker finds at least one page per base locale and `discoverLocales()` includes `en`, `de`, `fr`. Runs first so a misconfigured `CONTENT_ROOT` surfaces with a clear error before anything else.

**How to fix.** If this fails, the harness itself is broken — check `lib/paths.ts` and the actual `docs/` tree.

### `navigation.test.ts`

**What it checks.** Every slug in [`docs/nav.json`](../../docs/nav.json) resolves to a real `.md` or `.mdx` file in `en`, `de`, and `fr`.

**What it catches.** A page added in EN but not yet translated. A page deleted in EN without removing the nav entry. A typo in a nav slug.

**How to fix.** Create the missing file in the listed locale, or remove the nav entry. The companion change in `docs/nav.json` is usually one line.

### `frontmatter.test.ts`

**What it checks.** Every page has a YAML frontmatter block with `title` and `description`.

**What it catches.** A new page that was committed without frontmatter, or with one missing field.

**How to fix.** Add the missing field. `title` is sentence-case; `description` is one sentence completing "This page is about…".

### `filenames.test.ts`

**What it checks.** Every `.md`/`.mdx` filename and directory segment under a locale is dash-case lowercase (the locale segment itself is exempt — `de-CH` keeps its uppercase region subtag).

**What it catches.** `API_Reference.md`, `apiReference.md`, `MyPage.md` — anything that would render as an ugly URL.

**How to fix.** Rename the file. Grep the repo for inbound links and update them.

### `locale-tree.test.ts`

**What it checks.** For every page in `docs/en/`, DE and FR have a translated mirror at the same relative path. Orphans (locale pages with no English source) are also rejected.

**What it catches.** A page added in EN but not yet translated, a stale DE/FR page whose English source got deleted.

**How to fix.** Create the missing mirror or delete the orphan.

### `locale-outline.test.ts`

**What it checks.** Per-page heading-depth sequence and fenced-code-block count match between EN and each translated mirror.

**What it catches.** A restructure in EN that didn't propagate to DE/FR. A heading added or removed in one locale but not the others. An accidental drop of a code block in translation.

**How to fix.** Read the EN source. Restructure the failing locale to match the EN outline. If the EN page is genuinely the one that should change (rare), update DE and FR in the same PR.

### `readme.test.ts`

**What it checks.** `README.md`, `README.de.md`, `README.fr.md` keep the same structural shape — same heading outline; the English README links to every mirror.

**What it catches.** A README change in one language without the parallel updates.

**How to fix.** Mirror the change across all three READMEs.

### `structure-headings.test.ts`

**What it checks.** No body `# X` (the frontmatter `title` renders the H1); max heading depth H4; no stub heading names (`## Next`, `## See also`, `## Suite`, …) anywhere on the page.

**What it catches.** Duplicate H1, oversized heading depth, stub heading names mid-page.

**How to fix.** Demote body H1 to H2; split pages whose structure runs past H4; rename stub headings for what the section does.

### `structure-code.test.ts`

**What it checks.** Every fenced code block declares a language identifier. Bare ` ``` ` fences fail.

**What it catches.** A code block that renders without syntax highlighting because the language tag was forgotten.

**How to fix.** Add the language tag (`bash`, `typescript`, `json`, `text`, `mermaid`, …) after the opening fence.

### `structure-prose.test.ts`

**What it checks.** Two passes over every page's prose (with code fences, inline code, and URLs masked):

1. No `!` in prose outside legitimate contexts (`!=`, `!important`, link-image syntax).
2. No status-chatter prefixes (`Updated:`, `New in vX:`, `Coming soon:`, `TODO:`, `Note that…`, `Please note:` and locale equivalents) at the start of any line.

**What it catches.** Marketing exclamations; release-note metadata leaking into prose.

**How to fix.** Strike the exclamation; rewrite the chatter prefix or delete the sentence.

---

## The terminology layer (per-locale)

These checks fail when a translated page contradicts the shipped UI or uses the wrong pronoun. They read [`.agents/terminology/GLOSSARY.json`](../terminology/GLOSSARY.json) (the flat `terms[]` array) and the test-data modules under [`services/docs/tests/data/`](../../services/docs/tests/data/).

### `terminology-pronouns.test.ts`

**What it checks.** Rejects `Sie`/`Ihnen`/`Ihre`/`Ihrer`/`Ihres`/`Ihrem`/`Ihren` in German and `vous`/`votre`/`vos` in French — sourced from [`tests/data/formal-pronouns.ts`](../../services/docs/tests/data/formal-pronouns.ts). Sentence-initial `Sie` in DE is heuristically allowed because it's often the third-person plural `sie` capitalised; restructure to avoid the ambiguity anyway.

**What it catches.** Pronoun slips in DE and FR prose.

**How to fix.** Rewrite to the informal form (`du` / `tu`). Read [`TERMINOLOGY_DE.md`](../terminology/TERMINOLOGY_DE.md) §1 or [`TERMINOLOGY_FR.md`](../terminology/TERMINOLOGY_FR.md) §1 for the voice rule.

### `terminology-ui.test.ts`

**What it checks.** Iterates the `terms[]` array in [`GLOSSARY.json`](../terminology/GLOSSARY.json) and rejects the English form when (a) the entry's `category` is in the enforced set (`feature`, `role`, `knowledgeEntity`, `translateBucket`), (b) the resolved locale form differs from `en`, and (c) the entry doesn't carry `_lintExclude` for this locale. Example: `Customers` in a `docs/de/**` page is rejected (the shipped UI says `Kunden`); `Workflow` is not flagged (`category: "loanword"`, same form in all locales).

**What it catches.** UI-label drift between docs and the shipped product. Half-translated sentences (`Öffne **Settings > Members**`).

**How to fix.** Replace the English noun with the locale form. Grep `services/platform/messages/<locale>.json` for the source of truth. If the UI form has changed, update the relevant `terms[]` entry in `GLOSSARY.json` in the same PR.

### `terminology-loanword.test.ts`

**What it checks.** Narrower variant of `terminology-ui.test.ts`, scoped to `category === "translateBucket"` in [`GLOSSARY.json`](../terminology/GLOSSARY.json). For each Bucket-3 entry, the test rejects the English form appearing in DE/FR/de-CH page bodies (outside code fences, inline-code spans, and link URLs). Useful for the sharper, narrower error message.

**What it catches.** The most common translation failure mode — leaving an English noun in DE/FR prose when a clean native equivalent exists. `Schicke deinen Request an die API.` → bug; should be `Anfrage`. `Configure ton Email Provider.` → bug; should be `fournisseur de courriel`.

**How to fix.** Use the native term from the glossary entry.

### `terminology-compounds.test.ts`

**What it checks.** Rejects half-translated compounds from [`tests/data/half-compounds.ts`](../../services/docs/tests/data/half-compounds.ts) — patterns like `Pull Anfrage`, `Code Review-Prozess`, `Branch-Zweig`, `Knowledge-Datenbank`.

**What it catches.** A multi-word technical term split across languages.

**How to fix.** Translate the compound whole or keep it whole. Git-domain compounds stay English (`Pull Request`); product compounds translate (`Knowledge Base` → `Wissensdatenbank` / `Base de connaissances`).

### `voice-en.test.ts`

**What it checks.** Rejects the English marketing-softener strike list (`simply`, `easy`, `easily`, `powerful`, `seamless`, `seamlessly`, `just`, `please`, `feel free to`, `discover`, `unleash`, `effortlessly`, `straightforward`, `intuitive`) in `docs/en/**`. List lives in [`tests/data/voice-strike-en.ts`](../../services/docs/tests/data/voice-strike-en.ts).

**What it catches.** Marketing voice creeping into the English source.

**How to fix.** Strike the word and let the demonstration carry the message.

### `voice-de.test.ts`

**What it checks.** Two passes over every `docs/de/**` and `docs/de-CH/**` page:

1. **Strike list** from [`tests/data/voice-strike-de.ts`](../../services/docs/tests/data/voice-strike-de.ts) — `einfach`, `bequem`, `nahtlos`, `intuitiv`, `Entdecke`, …
2. **Bureaucracy drift rules** from [`tests/data/voice-bureaucracy-de.ts`](../../services/docs/tests/data/voice-bureaucracy-de.ts) — line-initial `Wird X…` (passive present), sentence-final `erfolgreich`, line-initial `Damit`, calques like `in der Schleife` / `aus der Box`.

**What it catches.** German bureaucracy drift and marketing softening.

**How to fix.** Strike the softener; rewrite passive-present to active; verb-first for `Damit` openers.

### `voice-fr.test.ts`

**What it checks.** Rejects the French marketing-softener strike list (`Découvre/Découvrez`, `N'hésite pas à`, `tout simplement`, `il te suffit de`, `simplement`, `facilement`, `puissant`, `clé en main`, `Profite/Profitez de`, `Bénéficie/Bénéficiez de`, `s'il te plaît`, …) in `docs/fr/**`. List lives in [`tests/data/voice-strike-fr.ts`](../../services/docs/tests/data/voice-strike-fr.ts).

**What it catches.** French marketing softening.

**How to fix.** Strike the softener; rewrite to the imperative.

### `grammar-de.test.ts`

**What it checks.** Indefinite-article gender agreement for the closed list of high-frequency Tale nouns at [`tests/data/noun-genders-de.ts`](../../services/docs/tests/data/noun-genders-de.ts). For each noun with a known gender, the test scans for `einen`/`eine`/`einem`/`einer`/`eines` (with up to two adjectives in between) and flags mismatches.

The regex is precision-tightened against the legacy version: a negative lookahead aborts the match when a preposition (`pro`, `mit`, `für`, `von`, `aus`, `bei`, `nach`, `seit`, `zu`, `gegen`, `ohne`, `um`, `durch`, …) appears between article and noun, and another lookahead rejects matches where the noun is followed by `-` (hyphenated compound). These two changes eliminate the `einen Chunk pro Token` and `eine Token-URL` classes of false positives.

**What it catches.** `einen einmaligen Warnung` (masculine accusative on a feminine noun) → should be `eine einmalige Warnung`. `eine Token` → should be `ein Token`.

**How to fix.** Consult the noun-gender map in `noun-genders-de.ts` and rewrite the article + adjective endings to agree. Definite-article cases (`der`/`die`/`das`/`dem`/`den`/`des`) are deliberately out of scope because they're ambiguous across case+number.

---

## The prose-quality layer (page shape)

These checks fail when a page's _shape_ doesn't meet the contract from [`.agents/docs/AGENTS.md`](../docs/AGENTS.md): a real opening, a real closing, no stubs.

### `structure-opening.test.ts`

**What it checks.** Every page (except files marked `kind: index` in frontmatter) opens with at least two sentences of prose between the frontmatter and the first sub-heading, list, table, or fenced code block.

**What it catches.** The one-sentence-then-list opening that the rewrite eliminated. `## Prerequisites` immediately after the frontmatter. A page that starts with a code block.

**How to fix.** Add a 2–4 sentence opening that answers _what / who / why_. The page-type playbooks in [`.agents/docs/AGENTS.md`](../docs/AGENTS.md) have a formula for each page type:

- **Feature reference**: `<Feature X> is <one-line definition>. <Audience> uses it for <use case>. <Reason it exists in the product>.`
- **Tutorial**: `<Outcome> requires <three or four moves>. This page walks all of them. <Prerequisites in one sentence>.`
- **Section overview**: `<Section X> is the part of Tale that does <Y>. <Audience> uses it for <Z>. <The order in which sub-pages should be read>.`

### `structure-closing.test.ts`

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
- **After editing any heading.** Heading text → slug; anchor links to that heading break silently. The `locale-outline.test.ts` test surfaces heading-outline drift across locales.
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

The test infrastructure lives at [`services/docs/tests/`](../../services/docs/tests/) with shared helpers under [`services/docs/tests/lib/`](../../services/docs/tests/lib/):

- [`lib/paths.ts`](../../services/docs/tests/lib/paths.ts) — `CONTENT_ROOT`, `DOCS_ROOT`, `REPO_ROOT`, `MESSAGES_ROOT`, `GLOSSARY_PATH`.
- [`lib/walk.ts`](../../services/docs/tests/lib/walk.ts) — `walkDocs()`, `discoverLocales()`, `localeOf()`, `filesInLocale()`, `BASE_LOCALES`.
- [`lib/markdown.ts`](../../services/docs/tests/lib/markdown.ts) — `parseFrontmatter`, `stripFences`, `maskInlineCode`, `maskUrls`, `extractHeadings`, `extractCodeFences`, `iterProseLines`, `extractOpeningProse`, `extractClosingSection`.
- [`lib/glossary.ts`](../../services/docs/tests/lib/glossary.ts) — `loadGlossary`, `resolveForm`, `termsByCategory`, `shouldEnforce`, `ENFORCED_CATEGORIES`, `isCapitalisedSentenceStart`.
- [`lib/regex.ts`](../../services/docs/tests/lib/regex.ts) — `escapeRegex`, `wordBoundary`, `wordBoundaryDe`, `wordBoundaryFr`.
- [`lib/findings.ts`](../../services/docs/tests/lib/findings.ts) — `Finding` type, `formatFindings`, `assertNoFindings`.
- [`lib/rules.ts`](../../services/docs/tests/lib/rules.ts) — `StrikeEntry`, `DriftRule`, `runStrikes`, `runDriftRules` for the voice and compound tests.
- `discoverLocales()` — every top-level locale subdirectory under `docs/` (regex `^[a-z]{2}(?:-[A-Z]{2})?$`).
- `localeOf(relPath)` — the locale of a content-relative path.

Adding a new check is two files: a new `*.test.ts` under `services/docs/tests/`, plus structured input. For term-shaped input (English → locale-form mapping), add an entry to `terms[]` in [`GLOSSARY.json`](../terminology/GLOSSARY.json). For input that isn't term-shaped (a closed wordlist, a regex set, a gender map), add a TypeScript module under [`services/docs/tests/data/`](../../services/docs/tests/data/) and import it directly — type-checked, no JSON round-trip. Use the `StrikeEntry` / `DriftRule` shapes in `lib/rules.ts` for term-list and regex-rule patterns; follow the structure of `voice-en.test.ts` / `grammar-de.test.ts`.

To extend the Bucket-3 translate-must set: add a new entry to `terms[]` in [`GLOSSARY.json`](../terminology/GLOSSARY.json) with `category: "translateBucket"` and the `de` / `fr` / `de_ch` overrides. Document the rationale in the entry's `_note`.

---

## Quick reference — every check on one line

| Test                            | Layer       | What it enforces                                                                         |
| ------------------------------- | ----------- | ---------------------------------------------------------------------------------------- |
| `walk.test.ts`                  | sanity      | Walker finds pages, base locales are present.                                            |
| `navigation.test.ts`            | structural  | Nav slugs resolve to real files in en/de/fr.                                             |
| `frontmatter.test.ts`           | structural  | Every page has `title` and `description`.                                                |
| `filenames.test.ts`             | structural  | Filenames are dash-case lowercase under each locale.                                     |
| `locale-tree.test.ts`           | structural  | DE/FR have a mirror for every English page; no orphans.                                  |
| `locale-outline.test.ts`        | structural  | DE/FR mirror the EN heading outline and code-block count.                                |
| `readme.test.ts`                | structural  | READMEs in en/de/fr stay structurally in sync.                                           |
| `structure-headings.test.ts`    | structural  | No body H1, max depth H4, no stub heading names.                                         |
| `structure-code.test.ts`        | structural  | Every fenced code block declares a language identifier.                                  |
| `structure-prose.test.ts`       | structural  | No `!` in prose; no status-chatter prefixes.                                             |
| `structure-opening.test.ts`     | prose       | Every page opens with ≥ 2 sentences of prose.                                            |
| `structure-closing.test.ts`     | prose       | Every page closes with a real recap, not a stub.                                         |
| `terminology-pronouns.test.ts`  | terminology | Informal pronouns (`du`/`tu`), no `Sie`/`vous`.                                          |
| `terminology-ui.test.ts`        | terminology | UI-label terms match the shipped UI per locale.                                          |
| `terminology-loanword.test.ts`  | terminology | Translate-bucket English nouns are translated in DE/FR.                                  |
| `terminology-compounds.test.ts` | terminology | Half-translated compounds (`Pull Anfrage`, `Code Review-Prozess`, …) rejected.           |
| `voice-en.test.ts`              | voice       | English marketing softeners (`simply`, `easy`, `just`, …) stricken.                      |
| `voice-de.test.ts`              | voice       | German softeners + bureaucracy drift (`Wird X…`, `erfolgreich`, `Damit`).                |
| `voice-fr.test.ts`              | voice       | French marketing softeners (`Découvrez`, `simplement`, `il vous suffit de`, …) stricken. |
| `grammar-de.test.ts`            | terminology | German indefinite-article gender agreement, preposition-aware regex.                     |
