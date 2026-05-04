# Austrian German (de-AT) terminology

Variant of German (de). Read [`TERMINOLOGY.md`](TERMINOLOGY.md) and [`TERMINOLOGY_DE.md`](TERMINOLOGY_DE.md) first — those rules apply here too. **This file lists only what differs from the German base.**

Most Tale docs and UI strings do not need an Austrian override. Only add an override when the wording genuinely reads wrong to an Austrian reader, or when a local legal/business term applies. The goal is to keep maintenance low.

## Where to put overrides

- **UI (platform):** `services/platform/messages/de-AT.json`. Include only the keys whose values differ from `de.json`. Anything missing falls back to `de.json` automatically.
- **Docs (Mintlify):** `docs/.locale-overrides/de-AT/<same-path-as-base>.md`. Full-file override — the generator uses it in place of the `docs/de/` file. Keep the rest of the file identical to the base unless you're also changing it.

## Lexical overrides

Prefer Austrian usage when it's clearly the more natural choice. Don't force an Austrian term where Austrians accept the standard-German form.

| Standard German (de) | Austrian German (de-AT) | When to override                                   |
| -------------------- | ----------------------- | -------------------------------------------------- |
| Januar               | Jänner                  | Calendar month names in prose and date strings     |
| Februar              | Feber                   | Older form — only in traditional/legal contexts    |
| dieses Jahr          | heuer                   | Only in casual UX copy; keep "dieses Jahr" in docs |
| Sahne                | Schlagobers             | Unlikely to appear; noted for completeness         |
| E-Mail               | E-Mail                  | Same — no override needed                          |
| Handy                | Handy                   | Same loanword for mobile phone                     |

## Business / legal terms

- **Gesellschaft mit beschränkter Haftung (GmbH)** is valid in both. Use "GmbH" in address blocks (matches Ruler GmbH's registration in Switzerland — no Austrian-specific override needed there).
- For Austrian customer-facing legal references, the relevant authority is the **Datenschutzbehörde (DSB)**, Austria's supervisory authority. Override the privacy-policy rights paragraph only if you need to call this out explicitly — the base text already references "eine Aufsichtsbehörde in deinem EU/EWR-Mitgliedstaat" which covers it.

## Style

- SPELLING: identical to standard German. Use "ß" where the base uses it (Austria keeps "ß", unlike Switzerland). Do not "Swiss-ify" Austrian content.
- QUOTATION marks: `„Text“` (same as base).
- APOSTROPHES: straight ASCII `'` (same as base).
- DECIMAL comma, period or narrow-space thousands (same as base).
- DATES: `DD.MM.YYYY` (same as base). In Austrian prose, `Jänner` replaces `Januar` when the month is spelled out.
- CURRENCY in examples: EUR (same as Germany).
- TIME: 24-hour (same as base).

## Authorities and references

When a doc cross-references a legal authority, add an Austrian mention only if the meaning changes:

- Supervisory authority: **Datenschutzbehörde (DSB)** — mention only when the base text lists national authorities rather than the generic "Aufsichtsbehörde in deinem EU/EWR-Mitgliedstaat".

## Do not override

- Product feature names (Workflow, Dashboard, Canvas, Prompt Library, etc.) — keep English, same as base.
- Role names (Owner, Admin, Developer, Editor, Member) — keep English, same as base.
- Code, command output, environment variable names, CLI flags.
- API endpoints, JSON keys, error codes.
- External brand names (Microsoft, Docker, OpenRouter, etc.).
