# Terminology — the cross-locale policy

This file is the cross-locale ring of the terminology contract. The rules below apply in every locale Tale ships — English included. Per-language doctrine lives in `TERMINOLOGY_<LOCALE>.md`; **every concrete word, every translation pair, every drift→target example lives in [`GLOSSARY.json`](GLOSSARY.json)**. When this file and the glossary disagree, the glossary wins for words; this file wins for rules.

- Base locales: [`TERMINOLOGY_EN.md`](TERMINOLOGY_EN.md), [`TERMINOLOGY_DE.md`](TERMINOLOGY_DE.md), [`TERMINOLOGY_FR.md`](TERMINOLOGY_FR.md).
- Regional variants: [`TERMINOLOGY_DE_CH.md`](TERMINOLOGY_DE_CH.md). Each variant lists only what differs from its base.

## Scope

Three surfaces follow these rules:

1. **Platform UI** — `services/platform/messages/*.json`. Labels, buttons, status messages, errors. Space-constrained.
2. **Marketing site** — `services/web/messages/*.json`. Long-form marketing copy, FAQs, CTAs.
3. **Docs site** — `docs/**` page bodies and `services/docs/messages/*.json` chrome strings.

Where a rule differs between surfaces, the section calls it out. Notably, the **informal-form rule, the loanword policy, and the same-voice rule all apply to the marketing site too** — Tale addresses prospective customers in the same voice it addresses signed-in users.

---

## 1 · One voice across every locale

The English source has a deliberate voice — calm, opinionated, second-person informal, _why before what_. Every translation lands in the same place.

### What the voice contains

- **Second person, informal.** `you` in English, `du` in German, `tu` in French. Never `we`, never `the user`, never `Sie`, never `vous`.
- **Imperative for instructions.** `Run tale deploy` — never `You can run tale deploy`, never `Please run tale deploy`. Same in DE (`Führe tale deploy aus`) and FR (`Exécute tale deploy`). The reader did not ask for permission.
- **Why before what.** Every command, every config knob, every UI walkthrough names the _consequence_ before the mechanical step. The single most load-bearing voice rule.
- **No marketing softening.** Closed per-locale strike lists live at `marketingSofteners.*` in [`GLOSSARY.json`](GLOSSARY.json).
- **No exclamation marks** outside literal code (`!important`, `1 != 2`).
- **No status chatter** (`Updated:`, `New in v1.6:`, `Coming soon:`, `TODO:`, `Note that…`).

### The two drift modes the audit caught

A translation that preserves vocabulary but loses voice is still wrong. The two failure modes:

- **German drifting into passive bureaucracy** — `Wird gespeichert…`, `Damit werden Agents entfernt`, sentence-final adverbs (`erfolgreich aktualisiert`). The full pattern catalogue lives in [`TERMINOLOGY_DE.md`](TERMINOLOGY_DE.md); concrete drift→target examples at `antiPatternExamples.de` in [`GLOSSARY.json`](GLOSSARY.json).
- **French drifting into marketing softening** — `Découvrez nos…`, `N'hésitez pas à…`, `tout simplement`, stacked nominal phrases. The full pattern catalogue lives in [`TERMINOLOGY_FR.md`](TERMINOLOGY_FR.md); examples at `antiPatternExamples.fr`.

A page that reads calmly in English and bureaucratically in German has a tone bug, not just a wording bug. Fix the wording.

---

## 2 · The loanword policy

English shows up in DE/FR tech writing for legitimate reasons (the term is the term in the industry) and for bad reasons (the translator gave up). Three buckets decide which is which. The complete word lists for each bucket live in [`GLOSSARY.json`](GLOSSARY.json) — this file states the rule that governs each bucket, not the contents.

### Bucket 1 · Always English

Brand names (`Tale`, `Convex`, `OpenRouter`, `Claude`, `GitHub`, …), acronyms (`AI`, `LLM`, `API`, `MCP`, `RAG`, `OIDC`, …), and code identifiers (env vars, CLI flags, file paths, API paths, i18n keys, JSON keys, table names). These never translate, in any locale, on any surface.

The complete lists live at `alwaysEnglish.brands`, `alwaysEnglish.acronyms`, and `alwaysEnglish.codeIdentifiers` in [`GLOSSARY.json`](GLOSSARY.json).

**Role names — exception.** The six platform roles ship in English in the EN UI; the DE UI ships translated forms (`Inhaber`, `Admin`, `Entwickler`, `Redakteur`, `Mitglied`, `Deaktiviert`); the FR UI ships translated forms (`Propriétaire`, `Admin`, `Développeur`, `Éditeur`, `Membre`, `Désactivé`). The canonical mapping lives at `roleNames.matrix` in [`GLOSSARY.json`](GLOSSARY.json). Docs and marketing match the shipped UI per locale.

### Bucket 2 · Established loanwords (keep)

The German- and French-speaking tech industries use a closed set of English terms unchanged (`Workflow`, `Dashboard`, `Cloud`, `Webhook`, `Prompt`, `Token`, `Server`, `Canvas`, `Composer`, `Status`, `Integration`, `Tool`, `Pipeline`, `Branding`, `Open Source`, `Team`, plus their plurals and a few more). Translating them produces something the reader has to mentally retranslate.

Hyphenate when forming compounds with native words: `Webhook-Adresse`, `Workflow-Schritt`, `API-Schlüssel`. Capitalise per the target language's noun rules (German capitalises all nouns; French only at the start of a sentence).

The complete list lives at `establishedLoanwords.<locale>` in [`GLOSSARY.json`](GLOSSARY.json).

#### Bucket 2a · Git-domain loanwords

When docs (especially `develop/contributing-docker.md`, API reference notes, or PR-process descriptions) discuss source-control workflows, the developer-domain vocabulary stays English in DE and FR. Translation calques (`Pull Anfrage`, `Code Review-Prozess`, `Merge-Anfrage`) sound amateurish and fail review under the no-half-translation rule below.

The complete list (and the verb-conjugation note) lives at `gitDomainLoanwords.<locale>` in [`GLOSSARY.json`](GLOSSARY.json).

### 2 bis · The no-half-translation rule

A compound term is translated **whole** or kept **whole**. Half is always wrong. The two failure shapes:

1. **English head + native modifier** (or vice versa): `Pull Anfrage`, `Code Review-Prozess`, `Merge-Anfrage`, `Knowledge-Datenbank`, `Branch-Zweig`. Either keep the whole English form (Bucket 2 / 2a) or use the full native equivalent — never one of each.
2. **Translated head with a redundant English suffix**: `Workflow-Prozess`, `Webhook-Adresse-URL`, `Code Review-Vorgang`. The English term already names the thing; suffixing it with a native synonym is duplication. Drop the suffix.

The rule applies to every locale and every surface. Reviewer's quick test: read the compound aloud. If the language switches mid-word, the compound is broken. Caught (in part) by the Half-Translated Compound anti-pattern in [`.agents/docs/AGENTS.md`](../docs/AGENTS.md) and by `terminology.test.ts` where the half is a known UI-bucket term. Concrete drift→target pairs live at `antiPatternExamples.de.halfTranslatedCompound` and `antiPatternExamples.fr.halfTranslatedCompound`.

### Bucket 3 · Translate (must)

A closed set of English nouns has clean native equivalents that a native reader expects. Leaving them English signals lazy translation. Enforced by [`loanword.test.ts`](../../services/docs/tests/loanword.test.ts).

The pairs (English → DE → FR, with rationales) live at `translateBucket.de` and `translateBucket.fr` in [`GLOSSARY.json`](GLOSSARY.json). The most common members are `Header`, `Request`, `Provider`, `Email`, `Help Center`, `Billing`, `Sales Research`, `Draft`, `Attachment`, `Self-hosted` (plus FR-only `Engineering`).

### Bucket assignment criteria — when a new term arrives

When a new product feature, technical noun, or UI label needs a locale form, ask:

1. **Is it a brand name, acronym, or code identifier?** → Bucket 1. Never translates.
2. **Is the term used unchanged by the German- and French-speaking tech industry?** Check: does the term appear unchanged in (a) the documentation of major DE/FR-language tech products and (b) German and French Wikipedia? → If yes to both, Bucket 2 (keep loanword).
3. **Does the target language have a native equivalent that a native reader would prefer?** Look it up — DE Duden, FR Larousse, or industry-standard glossaries. → If yes, Bucket 3 (translate).
4. **When in doubt, lean toward Bucket 3.** Translation is the polite default; a loanword has to earn its keep.

Add the new term to [`GLOSSARY.json`](GLOSSARY.json) (the canonical word entry) and to the appropriate bucket in the same PR.

### Loanword red flags — four quick checks

Before committing any DE/FR translation, scan for:

1. **An English noun mid-sentence in DE/FR prose** that has a native form in Bucket 3.
2. **A sentence-end English word in DE/FR** that should be translated.
3. **A calqued English noun** — abstract English nouns (`story`, `journey`, `posture`, `surface`) translated literally. Translate the meaning, not the noun.
4. **A half-translated compound** — see the no-half-translation rule above.

---

## 3 · Length

- Keep translations roughly the same length as the English source — UI layouts are sized for English. Prefer shorter synonyms or abbreviations when the target language is notably longer (common in German; occasional in French).
- In docs, length parity is a soft guideline — clarity wins over line-matching.
- In marketing copy, length parity is enforced because the layout is fixed.

---

## 4 · Tone and voice per surface

| Surface     | Voice                              | Length                       | Marketing softening |
| ----------- | ---------------------------------- | ---------------------------- | ------------------- |
| Platform UI | Imperative for CTAs, short labels  | 1–3 words per button/label   | Banned              |
| Marketing   | Same Linear voice as docs          | Length-matched to EN layout  | Banned              |
| Docs site   | Calm, opinionated, why-before-what | Clarity wins over line-match | Banned              |

In every surface:

- **Plain language over jargon** in user-facing strings. Reserve jargon for terms with no plain-language equivalent.
- **The imperative carries instructions and CTAs.** Avoid `You can…`, `Please…`, `It is recommended…`. Active voice for state changes.
- **No sentence-final adverbs in DE/FR** — restructure (`erfolgreich aktualisiert` → `aktualisiert`).

---

## 5 · Error messages

Error messages tell the reader **what happened** and **what to do next**. Same shape across locales.

- One sentence is usually enough. End with a period.
- Never blame the reader. `Invalid input` → `Enter a valid email address.`
- Name the field or action that failed when it's not obvious from context.
- Link to recovery if recovery is non-trivial — but most errors don't need a link.

Common patterns, EN / DE / FR side by side:

| Pattern                     | English                                   | German                                                | French                                           |
| --------------------------- | ----------------------------------------- | ----------------------------------------------------- | ------------------------------------------------ |
| Missing required field      | `Enter a valid email address.`            | `Gib eine gültige E-Mail-Adresse ein.`                | `Saisis une adresse de courriel valide.`         |
| Auth failure                | `Wrong email or password.`                | `Falsche E-Mail oder falsches Passwort.`              | `Adresse de courriel ou mot de passe incorrect.` |
| Network failure (transient) | `Couldn't reach the server. Try again.`   | `Der Server ist nicht erreichbar. Versuch es erneut.` | `Le serveur est injoignable. Réessaie.`          |
| Permission denied           | `You don't have permission to do that.`   | `Du hast nicht die nötige Berechtigung.`              | `Tu n'as pas la permission de faire ça.`         |
| Validation (format)         | `Use letters, numbers, and dashes only.`  | `Nur Buchstaben, Zahlen und Bindestriche.`            | `Lettres, chiffres et tirets uniquement.`        |
| Quota exceeded              | `You've reached the limit for this plan.` | `Du hast das Limit dieses Plans erreicht.`            | `Tu as atteint la limite de ce plan.`            |

---

## 6 · Abbreviations

- Use `e.g.` and `i.e.` in English tooltips/descriptions, not `for example` or `that is` (saves space).
- Use `z. B.` and `d. h.` in German equivalents — with the non-breaking space between the period and the letter, per Duden.
- Use `p. ex.` and `c.-à-d.` in French equivalents.
- Expand an abbreviation on first use in long-form docs (`personally identifiable information (PII)` / `personenbezogene Daten (PII)` / `informations personnelles identifiables (PII)`). In UI labels, assume the reader knows the term from context.

The full per-locale list lives in [`GLOSSARY.json`](GLOSSARY.json) under `terms[]` where `category === "abbreviation"`.

---

## 7 · Plurals

- Use ICU `one`/`other` for plurals: `{count, plural, one {# item} other {# items}}`.
- All supported languages share this structure.
- Preserve the ICU placeholder syntax exactly — including the `#` symbol and the brace nesting. Translating around the syntax produces parse errors that ship to users.
- DE uses different forms for `one` and `other` (`# Element` / `# Elemente`). FR mirrors DE's structure.
- Some German plurals require the `zero` case explicitly when the prose reads more naturally that way (`Keine Elemente` vs `0 Elemente`); ICU supports `zero` — use it when it improves the reading.

---

## 8 · Placeholders and brand names

- Preserve ICU placeholders exactly (`{count, plural, ...}`, `{field}`, `{error, select, ...}`) — never translate placeholder names or reorder arguments.
- Do not translate brand names (see Bucket 1 — list at `alwaysEnglish.brands`).
- Do not translate code identifiers, environment variable names, CLI flags, file paths, or JSON keys.
- Inside code fences, even sample data stays as-is — translate only human-readable strings inside Mermaid node labels and prose captions.

---

## 9 · Product role names

The six platform roles — `Owner`, `Admin`, `Developer`, `Editor`, `Member`, `Disabled` — are proper nouns referring to a specific role in Tale. The shipped EN / DE / FR forms live at `roleNames.matrix` in [`GLOSSARY.json`](GLOSSARY.json).

Capitalise when naming the role; lowercase when the word is generic (`die Mitglieder deines Teams` — the team's members, lower; `ein Mitglied` — a Member as a role, capital).

When `member` refers generically to "someone on the team" rather than the capital-M Member role, translate it normally. Reserve the capitalised form for the role itself.

---

## 10 · UI ↔ docs consistency

- When docs reference a UI label, quote it verbatim in the UI's language for that locale.
- When the UI uses an established loanword (`Dashboard` in German), docs use the same loanword. Do not translate it in prose only to create a mismatch.
- Before writing a UI term in a translated page, grep `services/platform/messages/<locale>.json` for its key.
- When the shipped UI string and [`GLOSSARY.json`](GLOSSARY.json) disagree, the UI wins — update the glossary in the same PR.

---

## 11 · Dates, numbers, units

Per-locale conventions for date formats, decimal/thousands separators, time formats, units, and currency live at `styleConventions.<locale>` in [`GLOSSARY.json`](GLOSSARY.json). The rule that governs them:

- Inside code blocks, env var values, and cron expressions, **keep the canonical English/ISO format** because the runtime expects it.
- Outside code, follow the target locale's convention. Periods vs commas in decimals; 12-hour vs 24-hour clocks; non-breaking space placement.

---

## 12 · Quotation marks

Per-locale conventions for primary running prose, UI labels, and inside code blocks live at `styleConventions.<locale>` in [`GLOSSARY.json`](GLOSSARY.json). The rule that governs them:

- EN uses ASCII straight everywhere.
- DE uses `„text"` (low-9 + high-9) in prose; ASCII inside code and UI.
- DE-CH uses `«text»` (Swiss guillemets) or `„text"`.
- FR uses `« text »` (guillemets with NBSP) in prose; ASCII inside code and UI.
- Inside code, every locale preserves the source form.

For apostrophes:

- EN: ASCII `'` everywhere (`don't`, `Tale's`).
- DE: ASCII `'` everywhere. German prose rarely needs apostrophes.
- DE-CH: ASCII `'`. Thousands-separator `'` in `1'000` is the same character.
- FR: typographic `'` in docs prose (`l'équipe`, `aujourd'hui`); ASCII `'` inside `fr.json`, code blocks, and inline code spans — preserve the source form.

---

## 13 · Markdown and headings

- Sentence case for headings in every locale.
- Align markdown tables — pipes lined up, cells padded evenly. Reviewers read tables in editors, not just rendered.
- Preserve code-block language identifiers (` ```bash `, ` ```json `).
- Keep Mermaid diagram syntax untouched. Translate only node labels and prose captions.

---

## 14 · Anchor links across locales

The markdown renderer generates heading anchors from slugified heading text. When a heading's text differs between locales (which it will, since headings are translated), its anchor differs too.

- Keep cross-file links within the same locale.
- Do not reuse an English anchor inside a German or French file.
- When a heading changes in one locale, update every locale that links to the anchor.

---

## 15 · Inclusive language

- DE: prefer neutral plural nouns (`Mitglieder`, `Nutzer:innen` when gender visibility matters) over gender-marked forms. The shipped UI uses `Mitglieder` and `Nutzer`; don't introduce `Nutzer:innen` unless the UI does.
- FR: prefer neutral collective nouns (`l'équipe`, `les personnes`) over inclusive forms like `utilisateur·rice`. In space-tight UI, plain `utilisateur` is acceptable.
- EN: prefer `they`/`them` as the default singular pronoun for unknown subjects.

---

## Where things live

The contract is split across three surfaces:

- **Doctrine + illustrative tables** — `TERMINOLOGY*.md` in this directory. Voice rules, anti-pattern descriptions, drift→target pairs, marketing-softener strike lists, toast conventions, error-message patterns (above), per-locale style rules, and `de-CH` overrides. Read this when you want to understand a rule.
- **Term lookups** — [`GLOSSARY.json`](GLOSSARY.json), a single flat `terms[]` array with entries of shape `{ key, category, en, de?, fr?, de_ch?, _lintExclude?, _note? }`. Filter by `category` to find features, knowledgeEntities, technicalVocab, actionVerbs, deploymentVocab, role, brand, acronym, codeIdentifier, loanword, gitDomain, translateBucket, or abbreviation. Read this when you want the canonical form of a specific word.
- **Test inputs** — TypeScript modules under [`services/docs/tests/data/`](../../services/docs/tests/data/). Closed lists the tests consume directly: `formal-pronouns.ts` (the `Sie/vous` denylist consumed by [`terminology.test.ts`](../../services/docs/tests/terminology.test.ts)) and `noun-genders-de.ts` (consumed by [`grammar-de.test.ts`](../../services/docs/tests/grammar-de.test.ts)).

When this doctrine and the glossary disagree, the glossary wins for words; the doctrine wins for rules. When the glossary and the shipped UI disagree, the UI wins — update the glossary in the same PR.
