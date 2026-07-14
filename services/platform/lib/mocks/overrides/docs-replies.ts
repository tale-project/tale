/**
 * Prompt-keyed scripts for the docs screenshot pipeline
 * (`tests/docs-screenshots/`). The e2e `MOCK_TRIGGERS` produce correct but
 * visibly synthetic streams (and the trigger keyword shows in the user
 * bubble); docs captures need a workspace that reads like a real customer's.
 * Two kinds of script live here:
 *
 *  - `DOCS_REPLIES` — chat answers. A user message containing a `match`
 *    substring (case-insensitive) streams the scripted markdown `reply`, with
 *    `reasoning` first when present, so "Thinking" captures need no
 *    `e2e:reasoning` marker in the visible message. An entry may carry
 *    per-model variants (`byModel`) — Arena Mode streams ONE prompt into two
 *    model columns, and identical text in both reads as staged.
 *  - `DOCS_TRIAGE_SCORES` — the structured output of the task-triage
 *    workflow's `score` step, per seeded task (see below).
 *
 * Match phrases are distinctive full clauses that no e2e spec message
 * contains, so the default-path specs keep getting `CANNED_REPLY` verbatim
 * (pinned by `contract/openai-compat.test.ts`).
 */

/** The scripted payload a matched prompt streams — default, or per model. */
interface DocsReplyContent {
  /** Markdown streamed as `delta.content`. */
  readonly reply: string;
  /** Optional reasoning streamed first as `delta.reasoning_content`. */
  readonly reasoning?: string;
}

interface DocsReplyModelVariant extends DocsReplyContent {
  /**
   * Lowercase substring matched against the REQUESTED model id — the catalog
   * id on the wire (`anthropic/claude-haiku-4.5`), so a family fragment
   * (`claude-haiku`) matches every point release and the vendor-native id
   * alike.
   */
  readonly model: string;
}

interface DocsReply extends DocsReplyContent {
  /** Lowercase substring matched against the LAST user message. */
  readonly match: string;
  /**
   * Per-model overrides of the scripted content; the first whose `model` is a
   * substring of the requested model id wins, otherwise the entry's own
   * `reply`/`reasoning` stand. Arena Mode pins one model per column, so this
   * is what makes the two columns answer differently; every other surface
   * (a seeded chat thread, an auto-routed model) keeps the default.
   */
  readonly byModel?: readonly DocsReplyModelVariant[];
}

/**
 * The launch-checklist answer's opening line — shared by its default reply AND
 * every model variant, by construction.
 *
 * The docs seeder verifies a seeded chat thread by the first line of the
 * DEFAULT reply (`tests/docs-screenshots/seed-demo-org.ts` → `expectedReply`)
 * and deletes any thread that does not show it. That same prompt is seeded as a
 * normal chat, whose model is picked by auto-routing — so a model variant may
 * well be what renders there. A variant with its own opener would make the
 * seeder read the thread as stale and re-create it on every run.
 */
const LAUNCH_CHECKLIST_OPENER =
  'Here is a launch checklist based on the Website Relaunch project tasks:';

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
    // Also the Arena Mode prompt (`chat-arena-split`), which pins one model per
    // column — so each column gets its own answer below: same task, different
    // shape. Two hard constraints on every variant:
    //   - it OPENS with `LAUNCH_CHECKLIST_OPENER` (by construction below), and
    //   - it carries "launch-blocking ones" exactly once — the docs capture
    //     waits for that phrase to appear in the SECOND column.
    match: 'draft a launch checklist for the website relaunch',
    reply: [
      LAUNCH_CHECKLIST_OPENER,
      '',
      '1. **Content freeze** — final copy signed off by marketing.',
      '2. **Redirect map** — every legacy URL mapped and tested.',
      '3. **Performance pass** — Core Web Vitals green on the staging build.',
      '4. **Accessibility sweep** — keyboard navigation and contrast checked.',
      '5. **Rollback plan** — the previous build deployable in one step.',
      '',
      'Items 2 and 5 are the launch-blocking ones; the rest can land during the release window.',
    ].join('\n'),
    byModel: [
      {
        // Arena column A — the fast model: short, flat, gets to the point.
        model: 'claude-haiku',
        reply: [
          LAUNCH_CHECKLIST_OPENER,
          '',
          '1. **Freeze the content** — marketing signs off the homepage copy.',
          '2. **Ship the redirect map** — all 380 legacy URLs mapped and tested.',
          '3. **Check performance** — Core Web Vitals green on staging.',
          '4. **Sweep accessibility** — keyboard paths and AA contrast.',
          '5. **Rehearse the rollback** — the previous build back in one step.',
          '',
          'Steps 2 and 5 are the launch-blocking ones.',
        ].join('\n'),
      },
      {
        // Arena column B — the deeper model: grouped by phase, names the risks.
        model: 'claude-sonnet',
        reply: [
          LAUNCH_CHECKLIST_OPENER,
          '',
          '**Before the content freeze**',
          '',
          '- Homepage copy final and signed off by marketing.',
          '- Redirect map complete: 340 of the 380 legacy URLs are mapped today.',
          '',
          '**Go-live gates**',
          '',
          '- Core Web Vitals green on the staging build.',
          '- Accessibility sweep clean — keyboard navigation, focus order, AA contrast.',
          '- Rollback rehearsed: the previous build redeploys in one step, no data loss.',
          '',
          '**Risks worth flagging**',
          '',
          '- The 40 unmapped blog URLs are still an open decision — settle redirect-vs-keep before the freeze.',
          '- The accessibility sweep has no agreed severity bar, so "done" is undefined today.',
          '',
          'The redirect map and the rollback rehearsal are the launch-blocking ones; everything else can land inside the release window.',
        ].join('\n'),
      },
    ],
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
 * The scripted content for a chat body's last user message, or null when no
 * docs phrase matches (the caller falls through to the e2e scenarios). When
 * the matched entry scripts the requested `model`, that variant wins over its
 * default `reply`/`reasoning`.
 */
export function matchDocsReply(
  lastUserText: string,
  model?: string,
): DocsReplyContent | null {
  const text = lastUserText.toLowerCase();
  const entry = DOCS_REPLIES.find((reply) => text.includes(reply.match));
  if (!entry) return null;
  const modelId = (model ?? '').toLowerCase();
  return entry.byModel?.find((v) => modelId.includes(v.model)) ?? entry;
}

/**
 * The marker every `score`-step prompt of the auto-installed
 * `projects__tasks__triage-unassigned` automation carries (its
 * `score.config.userPrompt` renders the candidate list under this exact
 * heading), alongside `Task title: <title>`.
 */
const TRIAGE_PROMPT_MARKER =
  'Candidates (slug, description, isManager, preferred):'.toLowerCase();

/** A scripted `score` result for one seeded task. */
interface DocsTriageScore {
  /** Lowercase substring matched against the triage prompt — the task title. */
  readonly task: string;
  /**
   * The object the step's `generateObject` call must parse. Its schema requires
   * ALL THREE fields; `confidence` is optional HERE only so the one deliberate
   * failure below can omit it (see `DOCS_TRIAGE_SCORES`).
   */
  readonly score: {
    readonly slug: string;
    readonly confidence?: number;
    readonly reason: string;
  };
}

/**
 * The `score` step of the task-triage automation is a structured-output call
 * (`generateObject`, schema `{slug, confidence, reason}`) — and the mock's
 * blanket `{}` for every `json*` request fails its validation, so every scored
 * task ended in a FAILED run and the docs Executions capture was a wall of red.
 *
 * One entry per task the docs seeder creates (`tests/docs-screenshots/
 * demo-content.ts` → `DEMO_PROJECTS[].tasks`), so the runs complete and the log
 * reads like a real one:
 *
 *  - `slug` is `assistant` — the auto-installed agent, so the downstream
 *    `assign` action resolves a live candidate and the run reaches `done`.
 *  - `confidence` >= 0.7 clears the automation's auto-assign bar, so the run
 *    assigns the agent; below it the run leaves a suggestion comment instead.
 *    Both COMPLETE. Assignment is not free of side effects — it acks the task
 *    into `in_progress` (`agents/run_agent_on_task.ts`), moving its board card
 *    — so tasks on the captured board score below the bar and the assign path
 *    is exercised on the project no board shot captures.
 *  - "Prepare the rollback plan" deliberately omits `confidence`, so
 *    `generateObject` genuinely rejects it and that ONE run fails with a real
 *    schema-validation error — the red badge the execution-logs docs page
 *    teaches debugging from. Delete the field and every run turns green.
 *
 * Only the seeder's `todo` tasks reach the scoring step (the automation's guard
 * is `!assigneeId && status == 'todo'`; the rest short-circuit to its output
 * node and still complete). Every seeded task is scripted anyway, so flipping a
 * seeded status cannot turn a run red — the contract test pins that pairing.
 *
 * An unlisted task (any task an e2e spec creates) matches nothing and keeps the
 * `{}` fallback — its triage run fails exactly as it does today, so this script
 * cannot start assigning agents inside the e2e suite.
 */
const DOCS_TRIAGE_SCORES: readonly DocsTriageScore[] = [
  // Project: Website relaunch.
  {
    task: 'finalize homepage copy with marketing',
    score: {
      slug: 'assistant',
      confidence: 0.84,
      reason:
        'Homepage copy is a drafting job, and the 2026 brand guidelines are already indexed.',
    },
  },
  {
    task: 'map legacy urls to the new structure',
    score: {
      slug: 'assistant',
      confidence: 0.78,
      reason:
        'The content inventory lists all 380 legacy URLs, so building the redirect map is mechanical.',
    },
  },
  {
    task: 'run the accessibility sweep on staging',
    score: {
      slug: 'assistant',
      confidence: 0.72,
      reason:
        'The assistant can walk the WCAG checklist over staging and report what it finds.',
    },
  },
  {
    // The ONE deliberate failure: no `confidence`, so the step's schema
    // validation rejects it and this run ends `failed`. Keep exactly one.
    task: 'prepare the rollback plan',
    score: {
      slug: 'assistant',
      reason:
        'The launch-day runbook already sketches the rollback, so this is mostly a write-up.',
    },
  },
  {
    // Deliberately BELOW the auto-assign bar — twice right. The step's own
    // system prompt asks for a low score when a task "likely needs a human",
    // and a launch sign-off does; and this task sits on the ONE board the docs
    // capture (`projects-task-board` shoots DEMO_PROJECTS[0]), where an
    // assignment would ack the card into `in_progress` and empty the To do
    // column the seeder tuned. It still COMPLETES — via the suggestion branch.
    task: 'sign off the launch checklist',
    score: {
      slug: 'assistant',
      confidence: 0.55,
      reason:
        'The assistant can assemble the evidence for each item, but the sign-off itself needs the release owner.',
    },
  },
  {
    task: 'rebuild the legacy pricing page',
    score: {
      slug: 'assistant',
      confidence: 0.77,
      reason:
        'A single page rebuild against the new information architecture is well-scoped work.',
    },
  },
  {
    // Seeded in `backlog`, so the automation's guard routes it straight to the
    // output node and this score is never requested. It is scripted anyway: an
    // unscripted title falls back to `{}`, so the day someone moves this card to
    // To do it would fail the step and put a second red row in the docs shot.
    task: 'audit the third-party scripts',
    score: {
      slug: 'assistant',
      confidence: 0.69,
      reason:
        'The assistant can inventory the tags, but dropping one needs a call from marketing.',
    },
  },
  // Project: Customer onboarding portal.
  {
    task: 'draft the welcome email sequence',
    score: {
      slug: 'assistant',
      confidence: 0.88,
      reason:
        'A welcome sequence is writing work, and the onboarding checklist gives the assistant the beats.',
    },
  },
  {
    task: 'design the progress checklist screen',
    score: {
      slug: 'assistant',
      confidence: 0.73,
      reason:
        'The onboarding checklist defines the steps, so a first pass at the screen is well specified.',
    },
  },
  {
    task: 'wire the crm webhook for new sign-ups',
    score: {
      slug: 'assistant',
      confidence: 0.79,
      reason:
        'Webhook setup is documented work, and the Q2 support review flags it as a recurring gap.',
    },
  },
  {
    task: 'review the trial-to-paid handoff flow',
    score: {
      slug: 'assistant',
      confidence: 0.75,
      reason:
        'The handoff spans the onboarding checklist and the support notes, both of which the assistant can read.',
    },
  },
] as const;

/**
 * The scripted structured output for a task-triage `score` call, serialized as
 * the model would return it — or null when the prompt is not a triage call, or
 * names a task with no script (both keep the caller's `{}` fallback).
 */
export function matchDocsTriageScore(promptText: string): string | null {
  const text = promptText.toLowerCase();
  if (!text.includes(TRIAGE_PROMPT_MARKER)) return null;
  const entry = DOCS_TRIAGE_SCORES.find((score) => text.includes(score.task));
  return entry ? JSON.stringify(entry.score) : null;
}
