/**
 * Prompt-keyed replies for the docs screenshot pipeline
 * (`tests/docs-screenshots/`). The e2e `MOCK_TRIGGERS` produce correct but
 * visibly synthetic streams (and the trigger keyword shows in the user
 * bubble); docs captures need chats that read like a real workspace. A user
 * message containing a `match` substring (case-insensitive) streams the
 * scripted markdown `reply` — with `reasoning` first when present, so
 * "Thinking" captures need no `e2e:reasoning` marker in the visible message.
 *
 * Match phrases are distinctive full clauses that no e2e spec message
 * contains, so the default-path specs keep getting `CANNED_REPLY` verbatim
 * (pinned by `lib/mocks/openai-compat.test.ts`).
 */

interface DocsReply {
  /** Lowercase substring matched against the LAST user message. */
  readonly match: string;
  /** Markdown streamed as `delta.content`. */
  readonly reply: string;
  /** Optional reasoning streamed first as `delta.reasoning_content`. */
  readonly reasoning?: string;
}

export const DOCS_REPLIES: readonly DocsReply[] = [
  {
    match: 'summarize the onboarding feedback',
    reasoning:
      'Reading the three feedback documents in the knowledge base, grouping the recurring points by theme, and ranking the themes by how often they come up.',
    reply: [
      'Across the three onboarding calls, the feedback clusters into three themes:',
      '',
      '| Theme | Mentions | Representative quote |',
      '| --- | --- | --- |',
      '| Setup took too long | 3 of 3 | "Two days from invite to first useful answer." |',
      '| Docs assume context | 2 of 3 | "The guide names screens I could not find." |',
      '| Loved the shared projects | 2 of 3 | "The team space made adoption easy." |',
      '',
      'The setup friction is the clear priority — every call raised it, and two customers tied it directly to their go-live date. The project workspace praise suggests leading future onboardings with a prepared shared project.',
    ].join('\n'),
  },
  {
    match: 'draft a launch checklist for the website relaunch',
    reply: [
      'Here is a launch checklist based on the Website Relaunch project tasks:',
      '',
      '1. **Content freeze** — final copy signed off by marketing.',
      '2. **Redirect map** — every legacy URL mapped and tested.',
      '3. **Performance pass** — Core Web Vitals green on the staging build.',
      '4. **Accessibility sweep** — keyboard navigation and contrast checked.',
      '5. **Rollback plan** — the previous build deployable in one step.',
      '',
      'Items 2 and 5 are the launch-blocking ones; the rest can land during the release window.',
    ].join('\n'),
  },
  {
    match: 'what changed in the brand guidelines',
    reply: [
      'Comparing the 2026 brand guidelines with the previous version, three things changed:',
      '',
      '- **Primary palette** — the blue deepened one step; the old accent teal is retired.',
      '- **Logo clearspace** — minimum clearspace grew from 0.5× to 1× the mark height.',
      '- **Tone of voice** — the "playful" register is gone; all copy now uses the direct register.',
      '',
      'Everything else — typography, iconography, photography rules — carried over unchanged.',
    ].join('\n'),
  },
  {
    match: 'plan the quarterly business review agenda',
    reasoning:
      'The QBR needs the numbers first, then the narrative: revenue and usage, then wins and risks, then next quarter. Keeping it to five items so it fits a 60-minute slot.',
    reply: [
      'A 60-minute QBR agenda that keeps the numbers up front:',
      '',
      '1. **Usage & revenue snapshot** (10 min) — quarter over quarter, one slide.',
      '2. **Wins** (10 min) — the two launches that moved adoption.',
      '3. **Risks** (15 min) — churn signals and the support backlog.',
      '4. **Roadmap next quarter** (15 min) — three committed items only.',
      '5. **Asks & decisions** (10 min) — what needs sign-off today.',
      '',
      'Send the snapshot deck a day ahead so the meeting starts at item 2.',
    ].join('\n'),
  },
  {
    match: 'python script to deduplicate',
    reasoning:
      'The export is a CSV keyed by email; normalizing case and whitespace before comparing catches most duplicates. Keeping the most recently updated row when two collide.',
    reply: [
      'This script keeps the most recently updated row per email address:',
      '',
      '```python',
      'import csv',
      'from datetime import datetime',
      '',
      'def parse(row):',
      '    return datetime.fromisoformat(row["updated_at"])',
      '',
      'rows = {}',
      'with open("crm-export.csv", newline="") as f:',
      '    for row in csv.DictReader(f):',
      '        key = row["email"].strip().lower()',
      '        if key not in rows or parse(row) > parse(rows[key]):',
      '            rows[key] = row',
      '',
      'with open("crm-deduped.csv", "w", newline="") as f:',
      '    writer = csv.DictWriter(f, fieldnames=next(iter(rows.values())).keys())',
      '    writer.writeheader()',
      '    writer.writerows(rows.values())',
      '```',
      '',
      'Point it at the export in the current directory; it writes `crm-deduped.csv` next to it and never mutates the original.',
    ].join('\n'),
  },
  {
    match: 'which customers mentioned pricing concerns',
    reply: [
      'Two customers raised pricing in the indexed conversations:',
      '',
      '- **Northwind Manufacturing** — asked whether seat pricing applies to read-only members (conversation from June 12).',
      '- **Bergmann Logistics** — compared the team plan with a competitor quote and asked about annual discounts (June 24).',
      '',
      'Both conversations are open in the inbox; neither has a follow-up scheduled yet.',
    ].join('\n'),
  },
] as const;

/**
 * The scripted reply for a chat body's last user message, or null when no
 * docs phrase matches (the caller falls through to the e2e scenarios).
 */
export function matchDocsReply(lastUserText: string): DocsReply | null {
  const text = lastUserText.toLowerCase();
  return DOCS_REPLIES.find((entry) => text.includes(entry.match)) ?? null;
}
