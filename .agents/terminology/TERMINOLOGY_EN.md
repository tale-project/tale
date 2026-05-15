# English (en) terminology

English is the source locale. Every translated string in the platform UI and in `docs/` derives from an English original; when the two drift, the English form is the authoritative reference. The cross-locale rules — voice, the loanword policy, length parity, plurals, placeholders, dates, numbers — live in [`TERMINOLOGY.md`](TERMINOLOGY.md). Read that file first.

This file is **doctrine only**: voice rules, anti-pattern descriptions, principles. Every concrete word list — product feature names, knowledge-base entities, technical vocabulary, action verbs, deployment vocabulary, the Git-domain table, role names, marketing softeners, anti-pattern drift→target examples, toast and error patterns, abbreviations — lives in [`GLOSSARY.json`](GLOSSARY.json). When the doctrine and the glossary disagree, the glossary is the source of truth for words; the doctrine is the source of truth for rules.

---

## 1 · The English voice

Tale's English copy reads as one narrator. The reader is a capable peer who landed cold from a search result.

- **Second person.** `You`, never `we`, never `the user`. Marketing addresses the prospective customer in the same voice as the signed-in product.
- **Informal but precise.** Contractions where they read naturally (`don't`, `won't`, `you'll`) — but never slang. Tale is not a meme; it's a product.
- **Imperative for instructions.** `Run tale deploy` — not `You can run tale deploy`, not `Please run tale deploy`, not `It is recommended to run tale deploy`.
- **No marketing softening.** The closed list of words to strike on sight lives at `marketingSofteners.en` in [`GLOSSARY.json`](GLOSSARY.json). If you reach for one, the surrounding evidence is the right place to put the claim.
- **No exclamation marks** outside literal code.
- **Why before what.** Every command, every config knob, every UI walkthrough names the consequence — what happens in production, what breaks, what the alternative would have meant.

### Five EN-specific anti-patterns

These are the failure modes English copy drifts into when the voice slips. Each one has concrete drift→target pairs at `antiPatternExamples.en` in [`GLOSSARY.json`](GLOSSARY.json) — read the examples there, then apply the rule.

- **First-person we.** Tale's docs describe a product the reader operates; the author is invisible.
- **The Royal "It is".** `It is important to note that…` is filler. Cut it or rewrite as imperative.
- **The Naked Command.** A click instruction without its why. Add the consequence.
- **The Hype Sentence.** Stacks of marketing softeners pretending to be content. Strike them all; describe what the product does.
- **Status Chatter.** `Note: this changed in v1.6.` Release notes carry version history; git carries the rest.
- **Capitalisation Drift.** Title-cased UI labels in prose (`Knowledge Base`, `Prompt Library`). Sentence case wins; consult `productVocabulary.features` in [`GLOSSARY.json`](GLOSSARY.json) for the canonical form.

---

## 2 · Product vocabulary

Every concrete term — features, knowledge-base entities, technical vocabulary, actions, deployment terms — lives at `productVocabulary.*` in [`GLOSSARY.json`](GLOSSARY.json). The rules that govern them:

- **Capitalise when naming the feature**; lowercase when the word becomes a common noun (`in the canvas`, `open the knowledge base`).
- **Sentence case in prose**, not title case. `## Agent concepts`, not `## Agent Concepts`. Product names that ship with intentional capitalisation (`Arena Mode`) preserve it.
- **Match the shipped UI verbatim.** When the glossary and the UI disagree, the UI wins — update the glossary in the same PR.
- **One term per concept across the corpus.** Don't alternate between `Chat` and `Chat with AI`, `Conversations` and `Inbox`, `Approval` and `Sign-off`. The glossary names the canonical form.
- **Git-domain vocabulary** (pull requests, merges, branches, commits, …) is documented at `gitDomainLoanwords` and `productVocabulary.gitDomain` in [`GLOSSARY.json`](GLOSSARY.json). The same terms stay English in DE/FR.

The `Thread` / `Conversation` rule is worth its own line: in user-facing prose, the product term is **Conversation**. `Thread` only lives in code (the `threads` table) and a few internal API surfaces. The same rule applies in every locale.

---

## 3 · Actions, toasts, and error messages

Button labels and menu items are short and imperative. Verb/noun pairings follow the two-word/one-word convention — `set up` (verb) / `setup` (noun); `log in` (verb) / `login` (noun); `back up` (verb) / `backup` (noun). The action-verb table lives at `productVocabulary.actionVerbs` in [`GLOSSARY.json`](GLOSSARY.json).

**Toasts** name what happened, past tense, no period, the noun first. `Successfully` is struck — the toast is the success signal. Patterns at `toastConventions.en` in [`GLOSSARY.json`](GLOSSARY.json).

**Error messages** say what happened and what to do next, in one sentence ending with a period. Never blame the reader. Name the field or action that failed when context doesn't make it obvious. The pattern table lives at `errorMessagePatterns` in [`GLOSSARY.json`](GLOSSARY.json).

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

The per-locale style-convention machine-readable forms live at `styleConventions.en` in [`GLOSSARY.json`](GLOSSARY.json).
