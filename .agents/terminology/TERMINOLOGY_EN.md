# English (en) terminology

English is the source locale. Every translated string in the platform UI and in `docs/` derives from an English original; when the two drift, the English form is the authoritative reference. The cross-locale rules — voice, the loanword policy, length parity, plurals, placeholders, dates, numbers — live in [`TERMINOLOGY.md`](TERMINOLOGY.md). Read that file first.

**Where things live.** The doctrine (voice rules, anti-pattern descriptions, principles, illustrative drift→target tables) lives in this file. Term lookups — product feature names, knowledge-base entities, technical vocabulary, action verbs, deployment vocabulary, the Git-domain table, role names — live as flat entries in [`GLOSSARY.json`](GLOSSARY.json) under `terms[]`. Test-data lists (formal pronouns, German noun-gender map) live as TypeScript modules in [`services/docs/tests/data/`](../../services/docs/tests/data/).

---

## 1 · The English voice

Tale's English copy reads as one narrator. The reader is a capable peer who landed cold from a search result.

- **Second person.** `You`, never `we`, never `the user`. Marketing addresses the prospective customer in the same voice as the signed-in product.
- **Informal but precise.** Contractions where they read naturally (`don't`, `won't`, `you'll`) — but never slang. Tale is not a meme; it's a product.
- **Imperative for instructions.** `Run tale deploy` — not `You can run tale deploy`, not `Please run tale deploy`, not `It is recommended to run tale deploy`.
- **No exclamation marks** outside literal code.
- **Why before what.** Every command, every config knob, every UI walkthrough names the consequence — what happens in production, what breaks, what the alternative would have meant.

### Marketing softeners — strike on sight

| Strike          | Replace with                                                |
| --------------- | ----------------------------------------------------------- |
| simply          | (delete; describe the step without softening)               |
| easy            | (delete; let the demonstration carry the claim)             |
| powerful        | (delete or replace with concrete capability)                |
| seamless        | (delete; describe the missing-step that makes it seamless)  |
| just            | (delete)                                                    |
| please          | (delete; imperative does the work)                          |
| feel free to    | (delete)                                                    |
| discover        | (replace with `see`, `read`, or `open`)                     |
| unleash         | (delete)                                                    |
| effortlessly    | (delete)                                                    |
| straightforward | (delete; the demonstration shows it)                        |
| intuitive       | (delete; let the screenshot or walkthrough carry the claim) |

These trigger reviewer rejection on sight. If the thing is easy, the surrounding evidence is the right place to demonstrate it.

### Anti-pattern catalogue (English)

The failure modes English copy drifts into when the voice slips.

- **First-person we.** `We recommend you click Save` → `Click Save. The provider is reachable from agents on the next request.` Tale's docs describe a product the reader operates; the author is invisible.
- **The Royal "It is".** `It is important to note that…` → delete. `It is recommended to run tale deploy` → `Run tale deploy.`
- **The Naked Command.** `Click Save.` (no why) → `Click Save. The provider is reachable from agents on the next request.`
- **The Hype Sentence.** `Tale's powerful automation engine lets you simply discover the seamless way to build workflows.` → `Tale's automation engine runs multi-step workflows on schedules, events, and webhooks.`
- **Status Chatter.** `Note: this changed in v1.6.` → delete; release notes carry the version history.
- **Capitalisation Drift.** `Knowledge Base`, `Prompt Library`, `Todo List` → `Knowledge base`, `Prompt library`, `Research plan` (sentence case + correct product name).

---

## 2 · Product vocabulary

Every concrete term — features, knowledge-base entities, technical vocabulary, actions, deployment terms, Git-domain — lives as a flat entry in [`GLOSSARY.json`](GLOSSARY.json) under `terms[]`. Filter by `category` to find features, knowledgeEntities, technicalVocab, actionVerbs, deploymentVocab, role, brand, acronym, codeIdentifier, loanword, gitDomain, translateBucket, or abbreviation.

The rules that govern those entries:

- **Capitalise when naming the feature**; lowercase when the word becomes a common noun (`in the canvas`, `open the knowledge base`).
- **Sentence case in prose**, not title case. `## Agent concepts`, not `## Agent Concepts`. Product names that ship with intentional capitalisation (`Arena Mode`) preserve it.
- **Match the shipped UI verbatim.** When the glossary and the UI disagree, the UI wins — update the glossary in the same PR.
- **One term per concept across the corpus.** Don't alternate between `Chat` and `Chat with AI`, `Conversations` and `Inbox`, `Approval` and `Sign-off`. The glossary names the canonical form.

The `Thread` / `Conversation` rule is worth its own line: in user-facing prose, the product term is **Conversation**. `Thread` only lives in code (the `threads` table) and a few internal API surfaces. The same rule applies in every locale.

---

## 3 · Toasts and error messages

Button labels and menu items are short and imperative. Verb/noun pairings follow the two-word/one-word convention — `set up` (verb) / `setup` (noun); `log in` (verb) / `login` (noun); `back up` (verb) / `backup` (noun).

### Toast conventions

State-change confirmations follow one pattern. Past tense, no period, the noun first. **Strike `Successfully`** — the toast is the success signal; the adverb is redundant.

| Pattern            | Example              |
| ------------------ | -------------------- |
| `<Noun> <verb-ed>` | `Agent saved`        |
| `<Noun> <verb-ed>` | `Provider deleted`   |
| `<Noun> <verb-ed>` | `Workflow published` |

### Error message patterns

Error messages name what happened and what to do next, one sentence ending with a period. Never blame the reader. Name the field or action that failed when context doesn't make it obvious. The cross-locale pattern table lives in [`TERMINOLOGY.md`](TERMINOLOGY.md) §5.

---

## 4 · Style rules

- **Oxford comma** in lists of three or more.
- **Straight quotes** (`"…"`) everywhere — running prose, UI strings, code blocks. Tale's English docs do not use typographic `"…"`; ASCII keeps grep simple.
- **Apostrophes:** straight ASCII `'` everywhere — contractions (`don't`), possessives (`Tale's`), quoted strings.
- **En-dash** (`–`) for numeric ranges (`5–10 minutes`); **em-dash** (`—`) for parenthetical asides — like this.
- **ISO dates** (`2026-04-19`) in docs prose, log output, frontmatter. Wall-clock times render through `useFormatDate()` and follow the user's locale.
- **12-hour clock** with lowercase `am`/`pm` in user-facing copy (`9 am`, `10:30 pm`). **24-hour** in technical contexts (cron expressions, server logs).
- **Numbers under ten** in prose are spelled out (`three providers`, `five steps`) except when paired with units (`5 GB`, `3 ms`).
- **Capitalisation in headings** is sentence case — not title case. Proper nouns and product names keep their canonical form.
- **Role names** are proper nouns when naming the role (`an Editor can upload`), lowercase when generic (`a markdown editor`). Never abbreviated (`Admin.`, `Mem.`).

### Date and number formatting

| Surface             | Format                               |
| ------------------- | ------------------------------------ |
| Date in prose       | `April 19, 2026` or `2026-04-19`     |
| ISO date in code    | `2026-04-19`                         |
| Decimal in prose    | `2.5 GB`                             |
| Thousands separator | `1,000` or `1000`                    |
| Time, wall clock    | `9 am`, `10:30 pm` (lowercase am/pm) |
| Time, server-side   | UTC, 24-hour                         |
| Units               | `MB`, `GB`, `s`, `ms`                |
| Currency            | `$100`, `€100`, `CHF 100`            |
| Percent             | `5%` (no space)                      |
| Quote marks         | `"text"` (ASCII straight everywhere) |
| Apostrophe          | `'` (ASCII everywhere)               |
