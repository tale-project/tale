# Terminology — the cross-locale policy

This file is the cross-locale ring of the terminology contract. The rules below apply in every locale we ship — English included. Per-language tables and quirks live alongside this file in `TERMINOLOGY_<LOCALE>.md`; the machine projection lives in `GLOSSARY.json`.

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
- **Why before what.** Every command, every config knob, every UI walkthrough names the _consequence_ before the mechanical step. This is the single most load-bearing voice rule; preserve it in every translation.
- **No marketing softening.** Strike `simply`, `easy`, `powerful`, `seamless`, `just`, `please`, `feel free to`, `discover`, `unleash`, `effortlessly`, `straightforward`, `intuitive`. Per-language equivalents are listed in each `TERMINOLOGY_<LOCALE>.md`.
- **No exclamation marks** outside literal code (`!important`, `1 != 2`).
- **No status chatter** (`Updated:`, `New in v1.6:`, `Coming soon:`, `TODO:`, `Note that…`).

### The two drift modes the audit caught

A translation that preserves vocabulary but loses voice is still wrong. The two failure modes:

- **German drifting into passive bureaucracy.** `Wird gespeichert…` (`is being saved…`), `Damit werden Agents entfernt` (`this thereby removes agents`), sentence-final adverbs (`erfolgreich aktualisiert`). Replace with active verbs and natural word order: `Speichern…`, `Entfernt Agents, Workflows und Anbieter`, `Aktualisiert`. The full catalogue lives in [`TERMINOLOGY_DE.md`](TERMINOLOGY_DE.md).
- **French drifting into marketing softening.** `Découvrez nos…`, `N'hésitez pas à…`, `tout simplement`, stacked nominal phrases like `une solution clé en main pour la gestion documentaire intégrée`. Replace with verb-first imperatives and concrete nouns: `Importe les documents…`, `Ajoute une intégration…`. The full catalogue lives in [`TERMINOLOGY_FR.md`](TERMINOLOGY_FR.md).

A page that reads calmly in English and bureaucratically in German has a tone bug, not just a wording bug. Fix the wording.

---

## 2 · The loanword policy

English shows up in DE/FR tech writing for legitimate reasons (the term is the term in the industry) and for bad reasons (the translator gave up). Three buckets decide which is which.

### Bucket 1 · Always English

Brand names, code identifiers, acronyms. These never translate, in any locale, on any surface.

**Brand names.** `Tale`, `Convex`, `OpenRouter`, `Claude`, `OpenAI`, `Anthropic`, `Google`, `Mistral`, `Meta`, `DeepSeek`, `Moonshot`, `Qwen`, `GitHub`, `Slack`, `Gmail`, `Outlook`, `Shopify`, `Microsoft`, `Docker`, `Kubernetes`, `Prometheus`, `Grafana`, `Ollama`, `vLLM`, `LocalAI`, `Authelia`, `Authentik`, `oauth2-proxy`, `Authelia`, `Meetily`.

**Acronyms.** `AI`, `LLM`, `API`, `MCP`, `RAG`, `OIDC`, `SAML`, `PII`, `SOPS`, `TLS`, `SSL`, `URL`, `URI`, `HTTP`, `HTTPS`, `JSON`, `YAML`, `XML`, `SQL`, `CLI`, `SDK`, `IDE`, `CI`, `CD`, `SaaS`, `VPC`, `RBAC`, `2FA`, `MFA`, `SSO`, `TOTP`, `CSV`, `PDF`, `DOCX`, `XLSX`, `PNG`, `JPG`, `SVG`, `MD`, `MDX`, `CSS`, `HTML`. Per-locale conventions decide whether to expand on first use — see each `TERMINOLOGY_<LOCALE>.md`.

**Code identifiers.** Env vars (`TALE_CONFIG_DIR`, `SOPS_AGE_KEY`), CLI flags (`--detach`, `--verbose`), file paths (`docker-compose.yml`, `providers/openrouter.json`), API paths (`POST /api/v1/documents`), i18n keys (`chat.canvas.title`), JSON keys (`defaults.chat.model`), database table names (`threads`, `auditLogs`).

**Role names — exception.** The six platform roles ship in English in the EN UI: `Owner`, `Admin`, `Developer`, `Editor`, `Member`, `Disabled`. The DE UI ships translated forms (`Inhaber`, `Admin`, `Entwickler`, `Redakteur`, `Mitglied`, `Deaktiviert`); the FR UI ships translated forms (`Propriétaire`, `Admin`, `Développeur`, `Éditeur`, `Membre`, `Désactivé`). Docs and marketing match the shipped UI per locale.

### Bucket 2 · Established loanwords (keep)

The German- and French-speaking tech industry uses these terms natively. Translating them produces something the reader has to mentally retranslate.

| Term          | Rationale                                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `Workflow`    | The universal noun for a multi-step automation. `Arbeitsablauf` / `flux de travail` would feel like translation.           |
| `Dashboard`   | Universal across the industry. `Übersichtsseite` / `tableau de bord` are heavier and less specific.                        |
| `Cloud`       | The universal noun for managed-SaaS. `Wolke` would be wrong.                                                               |
| `Webhook`     | No native equivalent exists in either language.                                                                            |
| `Prompt`      | The standard term for AI-prompt input. `Eingabeaufforderung` / `invite` would read as a re-translation.                    |
| `Token`       | LLM token. Standard across both languages.                                                                                 |
| `Server`      | Standard across both languages.                                                                                            |
| `Canvas`      | Tale ships `Canvas` in DE and `Canevas` in FR. Loanword in DE, calque in FR — match the shipped UI.                        |
| `Composer`    | Tale ships `Composer` in DE and `Composeur` in FR. Match the shipped UI.                                                   |
| `Status`      | Already a native German and French noun.                                                                                   |
| `Integration` | Already a native German noun (`Integration`/`Integrationen`) and French noun (`Intégration(s)`).                           |
| `Tool`        | In product context (`an agent's tools`), `Tool` is the industry term. Use `Werkzeug` / `outil` only in metaphors.          |
| `Pipeline`    | Standard across both languages in the DevOps / data-engineering sense.                                                     |
| `Branding`    | The marketing-tech industry term. `Markenführung` / `image de marque` are heavier; both languages accept `Branding`.       |
| `Open Source` | Capitalised in DE (it's a compound noun); invariable in FR.                                                                |
| `Team`        | The shipped UI noun. `Mannschaft` / `équipe` only when context is purely generic (use `équipe` in FR, where it's natural). |

Hyphenate when forming compounds with native words: `Webhook-Adresse`, `Workflow-Schritt`, `API-Schlüssel`. Capitalise per the target language's noun rules (German capitalises all nouns; French only at the start of a sentence).

### Bucket 3 · Translate (must)

These have clean native equivalents that a native reader expects. Leaving them English signals lazy translation. Enforced by [`loanword.test.ts`](../../services/docs/tests/loanword.test.ts).

| English        | German (`de`)         | French (`fr`)           | Rationale                                                                                                                                              |
| -------------- | --------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Header         | `Kopfzeile`           | `En-tête`               | Both `Kopfzeile` and `En-tête` are the standard terms in their language. `Header` reads as undigested English.                                         |
| Request        | `Anfrage`             | `Requête`               | `Anfrage` is the native noun for any kind of request. `Requête` is the native noun for HTTP/API requests specifically.                                 |
| Provider       | `Anbieter`            | `Fournisseur`           | The native noun. Disambiguate in FR (`Fournisseur IA` vs the KB-entity `Fournisseur`) when context demands.                                            |
| Email          | `E-Mail`              | `Courriel`              | `E-Mail` is the Duden form. `Courriel` is the Académie Française form; the colloquial `email` is acceptable in space-tight UI but `courriel` in prose. |
| Help Center    | `Hilfe-Center`        | `Centre d'aide`         | Native compound in DE; native phrase in FR.                                                                                                            |
| Billing        | `Abrechnung`          | `Facturation`           | Native nouns. `Billing` reads as undigested English.                                                                                                   |
| Sales Research | `Vertriebs-Recherche` | `Recherche commerciale` | Native compounds. Often appears as a sample agent name in concept pages — translate the example too.                                                   |
| Engineering    | `Engineering` (keep)  | `Ingénierie`            | Established loanword in DE (the tech industry uses it). In FR, prose uses `Ingénierie`; only acceptable as loanword in job-title contexts.             |
| Draft          | `Entwurf`             | `Brouillon`             | Native nouns. The shipped UI uses these.                                                                                                               |
| Attachment     | `Anhang`              | `Pièce jointe`          | Native nouns. `Attachment` reads as undigested English.                                                                                                |
| Self-hosted    | `selbst gehostet`     | `Auto-hébergé`          | Native compound adjective. Lowercase in DE prose unless it's at the start of a sentence.                                                               |

### Bucket assignment criteria — when a new term arrives

When a new product feature, technical noun, or UI label needs a locale form, ask:

1. **Is it a brand name, acronym, or code identifier?** → Bucket 1. Never translates.
2. **Is the term used unchanged by the German- and French-speaking tech industry?** Check: does the term appear unchanged in (a) the documentation of major DE/FR-language tech products and (b) German and French Wikipedia? → If yes to both, Bucket 2 (keep loanword).
3. **Does the target language have a native equivalent that a native reader would prefer?** Look it up — DE Duden, FR Larousse, or industry-standard glossaries. → If yes, Bucket 3 (translate).
4. **When in doubt, lean toward Bucket 3.** Translation is the polite default; a loanword has to earn its keep.

Add the new term to [`TERMINOLOGY_EN.md`](TERMINOLOGY_EN.md), every locale file, and [`GLOSSARY.json`](GLOSSARY.json) in the same PR.

### Loanword red flags — three quick checks

Before committing any DE/FR translation, scan for:

1. **An English noun mid-sentence in DE/FR prose.** `Öffne den Header der Tabelle.` → bug; should be `Kopfzeile`.
2. **A sentence-end English word in DE/FR.** `Ein Beispiel-Workflow für Sales Research.` → bug; should be `Vertriebs-Recherche`.
3. **A calqued English noun.** `Vertrauenshaltung` for `trust posture` is a literal translation of an abstract English noun — the German reader prefers the concrete fact (`unsere Zertifizierungen`).

---

## 3 · Length

- KEEP translations roughly the same length as the English source — UI layouts are sized for English. Prefer shorter synonyms or abbreviations when the target language is notably longer (common in German; occasional in French).
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
- **The imperative carries instructions and CTAs.** Avoid `You can…`, `Please…`, `It is recommended…`. Active voice for state changes (`Speichert die Änderungen.` not `Die Änderungen werden gespeichert.`).
- **No sentence-final adverbs in DE/FR** — restructure (`erfolgreich aktualisiert` → `aktualisiert`).

---

## 5 · Error messages

Error messages tell the reader **what happened** and **what to do next**. Same shape across locales.

- ONE sentence is usually enough. END with a period.
- NEVER blame the reader. `Invalid input` → `Enter a valid email address.` / `Gib eine gültige E-Mail-Adresse ein.` / `Saisis une adresse de courriel valide.`
- NAME the field or action that failed when it's not obvious from context.
- LINK to recovery if recovery is non-trivial — but most errors don't need a link.

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

- USE `e.g.` and `i.e.` in English tooltips/descriptions, not `for example` or `that is` (saves space).
- USE `z. B.` and `d. h.` in German equivalents — with the non-breaking space between the period and the letter, per Duden.
- USE `p. ex.` and `c.-à-d.` in French equivalents.
- EXPAND an abbreviation on first use in long-form docs (`personally identifiable information (PII)` / `personenbezogene Daten (PII)` / `informations personnelles identifiables (PII)`). In UI labels, assume the reader knows the term from context.

---

## 7 · Plurals

- USE ICU `one`/`other` for plurals: `{count, plural, one {# item} other {# items}}`.
- All supported languages share this structure.
- PRESERVE the ICU placeholder syntax exactly — including the `#` symbol and the brace nesting. Translating around the syntax produces parse errors that ship to users.
- DE uses different forms for `one` and `other` (`# Element` / `# Elemente`). FR mirrors DE's structure.
- Some German plurals require the `zero` case explicitly when the prose reads more naturally that way (`Keine Elemente` vs `0 Elemente`); ICU supports `zero` — use it when it improves the reading.

---

## 8 · Placeholders and brand names

- PRESERVE ICU placeholders exactly (`{count, plural, ...}`, `{field}`, `{error, select, ...}`) — never translate placeholder names or reorder arguments.
- DO NOT translate brand names (see Bucket 1 above).
- DO NOT translate code identifiers, environment variable names, CLI flags, file paths, or JSON keys.
- INSIDE code fences, even sample data stays as-is — translate only human-readable strings inside Mermaid node labels and prose captions.

---

## 9 · Product role names

The six platform roles — `Owner`, `Admin`, `Developer`, `Editor`, `Member`, `Disabled` — are proper nouns referring to a specific role in Tale.

| Role      | EN          | DE            | FR             |
| --------- | ----------- | ------------- | -------------- |
| Owner     | `Owner`     | `Inhaber`     | `Propriétaire` |
| Admin     | `Admin`     | `Admin`       | `Admin`        |
| Developer | `Developer` | `Entwickler`  | `Développeur`  |
| Editor    | `Editor`    | `Redakteur`   | `Éditeur`      |
| Member    | `Member`    | `Mitglied`    | `Membre`       |
| Disabled  | `Disabled`  | `Deaktiviert` | `Désactivé`    |

Capitalise when naming the role; lowercase when the word is generic (`die Mitglieder deines Teams` — the team's members, lower; `ein Mitglied` — a Member as a role, capital).

When `member` refers generically to "someone on the team" rather than the capital-M Member role, translate it normally. Reserve the capitalised form for the role itself.

---

## 10 · UI ↔ docs consistency

- WHEN docs reference a UI label, quote it verbatim in the UI's language for that locale.
- WHEN the UI uses an established loanword (`Dashboard` in German), docs use the same loanword. Do not translate it in prose only to create a mismatch.
- BEFORE writing a UI term in a translated page, grep `services/platform/messages/<locale>.json` for its key.
- WHEN the shipped UI string and the terminology file disagree, the UI wins — update the terminology file and `GLOSSARY.json` in the same PR.

---

## 11 · Dates, numbers, units

| Surface               | EN                               | DE                         | FR                                  |
| --------------------- | -------------------------------- | -------------------------- | ----------------------------------- |
| Date in prose         | `April 19, 2026` or `2026-04-19` | `19.04.2026`               | `19/04/2026`                        |
| ISO date in logs/cron | `2026-04-19`                     | `2026-04-19`               | `2026-04-19`                        |
| Decimal in prose      | `2.5 GB`                         | `2,5 GB`                   | `2,5 Go`                            |
| Decimal in code/env   | `2.5`                            | `2.5`                      | `2.5`                               |
| Thousands separator   | `1,000` or `1000`                | `1.000` or `1 000`         | `1 000` (narrow non-breaking space) |
| Time, wall clock      | `9 am`, `10:30 pm` (lowercase)   | `09:00`, `22:30` (24-hour) | `9 h 00`, `22 h 30` (24-hour)       |
| Time, server-side     | UTC, 24-hour                     | UTC, 24-hour               | UTC, 24-hour                        |
| Units                 | `MB`, `GB`, `s`, `ms`            | `MB`, `GB`, `s`, `ms`      | `Mo`, `Go`, `s`, `ms`               |
| Currency in prose     | `$100`, `€100`, `CHF 100`        | `100 €`, `CHF 100`         | `100 €`, `100 CHF`                  |
| Percent               | `5%` (no space)                  | `5 %` (non-breaking space) | `5 %` (non-breaking space)          |

Inside code blocks, env var values, and cron expressions, **keep the canonical English/ISO format** because the runtime expects it.

---

## 12 · Quotation marks

| Locale | Primary (running prose)            | UI labels / short strings | Inside code blocks         |
| ------ | ---------------------------------- | ------------------------- | -------------------------- |
| EN     | `"text"` (ASCII straight)          | `"text"`                  | as written (do not change) |
| DE     | `„text"` (low-9 + high-9)          | `"text"`                  | as written                 |
| DE-CH  | `«text»` (guillemets) or `„text"`  | `"text"`                  | as written                 |
| FR     | `« text »` (guillemets, with NBSP) | `"text"`                  | as written                 |

For apostrophes:

- EN: ASCII `'` everywhere (`don't`, `Tale's`).
- DE: ASCII `'` everywhere (`geht's`). German prose rarely needs apostrophes.
- DE-CH: ASCII `'`. Thousands-separator `'` in `1'000` is the same character.
- FR: typographic `'` in docs prose (`l'équipe`, `aujourd'hui`); ASCII `'` inside `fr.json`, code blocks, and inline code spans — preserve the source form.

---

## 13 · Markdown and headings

- SENTENCE case for headings in every locale. `## Agent concepts`, `## Agent-Konzepte`, `## Concepts des agents`.
- ALIGN markdown tables — pipes lined up, cells padded evenly. Reviewers read tables in editors, not just rendered.
- PRESERVE code-block language identifiers (` ```bash `, ` ```json `).
- KEEP Mermaid diagram syntax untouched. Translate only node labels and prose captions.

---

## 14 · Anchor links across locales

The markdown renderer generates heading anchors from slugified heading text. When a heading's text differs between locales (which it will, since headings are translated), its anchor differs too.

- KEEP cross-file links within the same locale.
- DO NOT reuse an English anchor inside a German or French file.
- WHEN a heading changes in one locale, update every locale that links to the anchor.

---

## 15 · Inclusive language

- DE: prefer neutral plural nouns (`Mitglieder`, `Nutzer:innen` when gender visibility matters) over gender-marked forms. The shipped UI uses `Mitglieder` and `Nutzer`; don't introduce `Nutzer:innen` unless the UI does.
- FR: prefer neutral collective nouns (`l'équipe`, `les personnes`) over inclusive forms like `utilisateur·rice`. In space-tight UI, plain `utilisateur` is acceptable.
- EN: prefer `they`/`them` as the default singular pronoun for unknown subjects.

---

## Quick reference — the contract in one table

| Question                          | Answer                                                                                                                                                                             |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which pronoun?                    | EN `you`, DE `du`, FR `tu`. Never formal.                                                                                                                                          |
| Translate "Workflow"?             | No — established loanword (Bucket 2).                                                                                                                                              |
| Translate "Header" / "Request"?   | Yes — Bucket 3. `Kopfzeile` / `Anfrage` (DE), `En-tête` / `Requête` (FR).                                                                                                          |
| Translate role names?             | Yes for DE/FR — the UI ships translated forms. `Inhaber`/`Entwickler`/`Redakteur`/`Mitglied`/`Deaktiviert` (DE); `Propriétaire`/`Développeur`/`Éditeur`/`Membre`/`Désactivé` (FR). |
| German passive present?           | No. `Speichert…`, not `Wird gespeichert…`.                                                                                                                                         |
| French marketing softeners?       | No. Strike `Découvrez`, `N'hésitez pas à`, `tout simplement`.                                                                                                                      |
| Decimal separator in prose?       | EN period, DE/FR comma. Inside code, always period.                                                                                                                                |
| Quotation marks in prose?         | EN `"…"`, DE `„…"`, FR `« … »`. Inside code, leave as written.                                                                                                                     |
| UI label vs terminology disagree? | UI wins. Update the terminology file.                                                                                                                                              |
| New term — translate or keep?     | Default to translate unless the term is a brand, acronym, code identifier, or industry-standard loanword in DE/FR tech writing.                                                    |
