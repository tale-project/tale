# English (en) — voice doctrine

This file covers every value in `services/*/messages/en.yml` and every page under `docs/en/`. English is the source locale — translations derive from these strings. The cross-locale rules live one folder up at [`../../SKILL.md`](../../SKILL.md).

## The voice in this language

English Tale prose is calm, opinionated, and direct. The narrator is a peer who has shipped a similar product and is telling you how this one works. Sentences are short to medium. Imperatives carry walkthroughs (`Open Settings > Members and click Invite member.`). The why precedes the what (`To add a person to your organisation, open …`). No marketing, no apology, no `we`.

> **Positive example.** Open **Settings > Members** and click **Invite member**. The new member receives an email link valid for 24 hours and lands in the default role you pick — change it on the form before sending if they should not be a Member.

Three sentences, effect-first, no `simply`, no `please`, no exclamation. The 24-hour expiry is a consequence the reader needs and the page lands it inline rather than promising a "more on this later".

## The drift mode this language slips into

English drifts into corporate-marketing voice. The 12-word strike list catches the most common offenders (`simply`, `easy`, `powerful`, `seamless`, `just`, `please`, `feel free to`, `discover`, `unleash`, `effortlessly`, `straightforward`, `intuitive`). Each one asserts a quality the page should demonstrate instead.

> **Drift.** _Simply click **Save** and you're all set! Feel free to add as many providers as you like._
>
> **Target.** _Click **Save**. The new provider is reachable from agents on the next request — there's no separate rollout step, and existing conversations keep their previous model binding._

The strike list lives in [`packages/ui/src/i18n/tests/locales/en/voice.ts`](../../../../../packages/ui/src/i18n/tests/locales/en/voice.ts) — caught by `voice-strikes`.

## Conventions

See [CONVENTIONS.md](../../CONVENTIONS.md) for the full template; the values below are EN's.

| Surface                          | Rule                                 |
| -------------------------------- | ------------------------------------ |
| Pronoun (informal you)           | `you`                                |
| Quotation marks (prose)          | ASCII `"…"`                          |
| Apostrophe (prose)               | ASCII `'`                            |
| Apostrophe (message file & code) | ASCII `'`                            |
| Dates (prose)                    | `April 19, 2026` or ISO `2026-04-19` |
| Dates (code / ISO)               | `2026-04-19`                         |
| Time (wall clock)                | 12-hour: `9 am`, `10:30 pm`          |
| Decimal separator                | `.`                                  |
| Thousands separator              | `,`                                  |
| Currency                         | `$100` (USD, prefix)                 |
| Percent                          | `5%`                                 |
| Spelling                         | n/a                                  |
| En-dash for ranges               | yes: `2010–2020`                     |
| Em-dash style                    | unspaced `a—b`                       |

## Loanword stance

English is the source. Brands, acronyms, and code identifiers stay as-is (Bucket 1); product vocabulary uses the English form by definition. Where the EN word also lives in DE/FR vocabulary (`workflow`, `dashboard`, `webhook`), the bucket-2 status applies in translation and the EN form is unchanged. The translate-bucket only matters in non-EN languages — there is nothing to translate in EN.

## What ships untranslated

- Brands, acronyms, code identifiers — see [BUCKETS.md](../../BUCKETS.md).
- Role names: `Owner`, `Admin`, `Developer`, `Editor`, `Member`, `Disabled`.

## When the locale-specific test fires

The EN checks live in [`packages/ui/src/i18n/tests/checks/`](../../../../../packages/ui/src/i18n/tests/checks/) and consult [`packages/ui/src/i18n/tests/locales/en/`](../../../../../packages/ui/src/i18n/tests/locales/en/) data.

The most common firings:

- `voice-strikes` — one of the 12 striked words appeared. Strike or rewrite.
- `prose-exclamation` — `!` in prose. Delete; the page already demonstrates the point.
- `status-chatter` — `Updated:`, `New in v…:`, `Coming soon:`, `Note that…`, `TODO:`. Release notes and git carry version history.

> **Sample failure.** `[voice-strikes] voice-strikes — 1 violation: docs/en/platform/agents/concepts.md  42: [en-simply] marketing softener "Simply" — delete; the demonstration carries it`
