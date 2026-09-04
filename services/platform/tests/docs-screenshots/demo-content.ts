/**
 * Every believable literal the docs demo workspace shows, in one place. The
 * docs screenshot doctrine (builtin-configs/skills/write-docs/SCREENSHOTS.md)
 * requires captures to look like a real customer's workspace — named people,
 * plausible projects and documents — never `test test 123`. Fix the content
 * here and re-seed; never retouch a captured image.
 *
 * The chat prompts pair 1:1 with `lib/mocks/overrides/docs-replies.ts` — a
 * prompt must contain its reply's `match` phrase or the mock answers with the
 * visibly synthetic e2e canned reply.
 *
 * The TASK TITLES are paired the same way, against `DOCS_TRIAGE_SCORES` in that
 * file: every `todo` task trips the task-triage automation, whose scoring step
 * is a structured-output call the mock answers by title. A `todo` task with no
 * scripted score falls back to `{}`, fails the step's schema, and lands a red
 * row in the Executions screenshot — so rename a task here and rename it there.
 */

import { E2E_PASSWORD } from '../e2e/helpers/auth';

/** The demo owner — a fictional person on a reserved example domain. */
export const DEMO_OWNER = {
  name: 'Alex Rivera',
  email: 'alex.rivera@example.com',
  password: E2E_PASSWORD,
} as const;

/** Workspace name — shows in the sidebar and org switcher on every shot. */
export const DEMO_ORG_NAME = 'Northlight Labs';

/**
 * A seeded task. `status` is picked in the create dialog (task-modal's Status
 * field) — without it every task lands in `todo` and the board screenshots as
 * one full column and four empty ones.
 *
 * Only `todo` tasks reach the triage automation's scoring step (its guard is
 * `!assigneeId && status == 'todo'`); the rest short-circuit to the output node
 * and still complete. That mix is what makes the run log look real.
 */
export interface DemoTask {
  readonly title: string;
  /** `tasks.status.*` key — todo | in_progress | in_review | done | cancelled. */
  readonly status: string;
}

export interface DemoProject {
  readonly name: string;
  readonly tasks: readonly DemoTask[];
}

export const DEMO_PROJECTS: readonly DemoProject[] = [
  {
    name: 'Website relaunch',
    // Spread across every board column — including Backlog and Cancelled, the
    // two the board renders at its edges — so the kanban shot shows a project in
    // flight rather than a single stack of To do cards.
    tasks: [
      { title: 'Sign off the launch checklist', status: 'todo' },
      { title: 'Audit the third-party scripts', status: 'backlog' },
      // The triage automation's one failing run (the mock answers this task's
      // scoring step with a payload that violates the step's output schema —
      // lib/mocks/overrides/docs-replies.ts). The execution-logs docs page
      // teaches debugging from exactly this red badge.
      { title: 'Prepare the rollback plan', status: 'todo' },
      { title: 'Finalize homepage copy with marketing', status: 'in_progress' },
      { title: 'Run the accessibility sweep on staging', status: 'in_review' },
      { title: 'Map legacy URLs to the new structure', status: 'done' },
      { title: 'Rebuild the legacy pricing page', status: 'cancelled' },
    ],
  },
  {
    name: 'Customer onboarding portal',
    tasks: [
      { title: 'Design the progress checklist screen', status: 'todo' },
      { title: 'Wire the CRM webhook for new sign-ups', status: 'todo' },
      { title: 'Draft the welcome email sequence', status: 'in_progress' },
      { title: 'Review the trial-to-paid handoff flow', status: 'done' },
    ],
  },
] as const;

export interface DemoDocument {
  readonly fileName: string;
  readonly mimeType: string;
  readonly content: string;
}

export const DEMO_DOCUMENTS: readonly DemoDocument[] = [
  {
    fileName: '2026-brand-guidelines.txt',
    mimeType: 'text/plain',
    content: [
      '# Northlight Labs brand guidelines (2026)',
      '',
      '## Palette',
      'Primary: deep blue #1B3A6B. The accent teal from 2025 is retired.',
      '',
      '## Logo',
      'Minimum clearspace is 1x the mark height on every side.',
      '',
      '## Tone of voice',
      'Direct register only. Short sentences. No exclamation marks.',
    ].join('\n'),
  },
  {
    fileName: 'q2-support-review.txt',
    mimeType: 'text/plain',
    content: [
      '# Q2 support review',
      '',
      'Ticket volume rose 12% quarter over quarter; median first response',
      'held at 42 minutes. The top three drivers: password resets, webhook',
      'configuration, and CSV import limits. Webhook questions doubled after',
      'the April release — the setup guide needs a worked example.',
    ].join('\n'),
  },
  {
    fileName: 'onboarding-checklist.txt',
    mimeType: 'text/plain',
    content: [
      '# Customer onboarding checklist',
      '',
      '1. Kickoff call scheduled within 3 days of signature.',
      '2. Workspace created and branded before the kickoff.',
      '3. First shared project prepared with example tasks.',
      '4. Success metrics agreed and written into the account plan.',
    ].join('\n'),
  },
] as const;

/** The "Website relaunch" project's description (General tab identity). */
export const DEMO_PROJECT_DESCRIPTION =
  'Rebuild of the public website: new information architecture, refreshed brand, zero-downtime cutover.';

/** The project's standing instructions (General tab) — every chat and run in
 * it starts from these. */
export const DEMO_PROJECT_INSTRUCTIONS = [
  'This project rebuilds the public website for a zero-downtime cutover.',
  'Ground every answer in the content inventory and the launch-day runbook before anything else, write in the voice of the 2026 brand guidelines, and treat any change to the redirect map as launch-blocking until the owning section has signed it off.',
].join(' ');

export interface DemoProjectAgent {
  readonly name: string;
  /** Harness display name, as the Agent type picker lists it. */
  readonly harness: string;
  /** Model id, as the mock catalog serves it. */
  readonly model: string;
  readonly instructions: string;
}

/**
 * The "Website relaunch" project's crew (Agents tab): named agents, each with
 * a harness, a model from the mock catalog, and standing instructions.
 */
export const DEMO_PROJECT_AGENTS: readonly DemoProjectAgent[] = [
  {
    name: 'Content editor',
    harness: 'Claude Code',
    model: 'anthropic/claude-sonnet-4.6',
    instructions:
      'Rewrite migrated pages in the voice of the 2026 brand guidelines. Keep every product claim traceable to the content inventory, and hand anything that needs a legal or product decision back as a task comment instead of guessing.',
  },
  {
    name: 'Redirect auditor',
    harness: 'Codex',
    model: 'anthropic/claude-haiku-4.5',
    instructions:
      'Check every legacy URL in the redirect map against the launch-day runbook. File one task per unmapped URL with its owning section; never edit the map yourself.',
  },
] as const;

/** Files attached to the "Website relaunch" project's Knowledge tab. */
export const DEMO_PROJECT_FILES: readonly DemoDocument[] = [
  {
    fileName: 'relaunch-content-inventory.txt',
    mimeType: 'text/plain',
    content: [
      '# Relaunch content inventory',
      '',
      '380 legacy URLs audited. 214 pages migrate as-is, 126 merge into the',
      'new structure, 40 low-traffic blog posts redirect to the blog index.',
      'Owners per section are listed in the migration sheet.',
    ].join('\n'),
  },
  {
    fileName: 'launch-day-runbook.txt',
    mimeType: 'text/plain',
    content: [
      '# Launch day runbook',
      '',
      '1. Content freeze at 08:00 — no CMS edits until go-live.',
      '2. Deploy behind the maintenance flag; smoke-test the redirect map.',
      '3. Flip DNS at 10:00; monitor Core Web Vitals for one hour.',
      '4. Rollback: redeploy the previous build, one step, no data loss.',
    ].join('\n'),
  },
] as const;

export interface DemoKnowledgeEntry {
  readonly topic: string;
  readonly content: string;
}

/** Manually added knowledge entries (Knowledge > Knowledge entries). */
export const DEMO_KNOWLEDGE_ENTRIES: readonly DemoKnowledgeEntry[] = [
  {
    topic: 'Support first-response target',
    content:
      'Support aims for a first response within 45 minutes during business hours (Mon–Fri, 9:00–17:00 CET). The Q2 median was 42 minutes.',
  },
  {
    topic: 'Brand primary color',
    content:
      'The 2026 primary is deep blue #1B3A6B. The 2025 accent teal is retired and must not appear in new material.',
  },
  {
    topic: 'Onboarding kickoff window',
    content:
      'Every new customer gets a kickoff call within 3 business days of contract signature. The workspace is created and branded before the call.',
  },
] as const;

export interface DemoProduct {
  readonly name: string;
  readonly description: string;
  readonly price: string;
  readonly currency: string;
  readonly stock?: string;
  readonly category: string;
  /** `common.status.*` key — active | inactive | draft | archived. */
  readonly status: string;
}

/**
 * Structured records (Knowledge > Products) — the typed rows agents read
 * fields from, as opposed to documents they retrieve passages from. Three
 * rows so the table teaches the shape (name, price, stock, category, status)
 * without scrolling; Episode 3's structured-data scene shows this table.
 */
export const DEMO_PRODUCTS: readonly DemoProduct[] = [
  {
    name: 'Analytics Pro — annual license',
    description: 'Full analytics suite for one workspace, billed yearly.',
    price: '1188',
    currency: 'USD',
    category: 'Licenses',
    status: 'active',
  },
  {
    name: 'Onboarding accelerator',
    description: 'Two-week guided rollout with a prepared shared project.',
    price: '1900',
    currency: 'USD',
    category: 'Services',
    status: 'active',
  },
  {
    name: 'Team training workshop',
    description: 'Half-day hands-on workshop for up to twelve seats.',
    price: '950',
    currency: 'USD',
    stock: '12',
    category: 'Services',
    status: 'draft',
  },
] as const;

/**
 * Seeded chats: each prompt contains its docs-reply match phrase (see the
 * module doc) so the assistant answer reads like a real workspace assistant.
 * Thread titles derive from the prompt text, so keep prompts title-shaped.
 */
export const DEMO_CHAT_PROMPTS: readonly string[] = [
  'Summarize the onboarding feedback from our last three customer calls',
  'Draft a launch checklist for the website relaunch project',
  'What changed in the brand guidelines this year?',
  'Plan the quarterly business review agenda for Friday',
  'Write a Python script to deduplicate our CRM export',
] as const;

interface DemoMember {
  readonly name: string;
  readonly email: string;
  /** `settings.roles.*` key. */
  readonly role: string;
}

/**
 * The rest of the workspace's people. Members are admin-provisioned (name,
 * email, password, role) — no invite mail — so the Members table shows a real
 * team instead of a lone owner.
 *
 * `DEMO_DEPARTING_MEMBER` is the subject of the legal hold and the erasure
 * request. It is deliberately NOT the owner: `requestErasure` schedules a real
 * cascade delete once the cooling-off window passes, and the demo org outlives
 * a capture run.
 */
export const DEMO_MEMBERS: readonly DemoMember[] = [
  { name: 'Priya Raman', email: 'priya.raman@example.com', role: 'admin' },
  { name: 'Sam Okonkwo', email: 'sam.okonkwo@example.com', role: 'editor' },
  { name: 'Marta Vogel', email: 'marta.vogel@example.com', role: 'member' },
  { name: 'Jordan Blake', email: 'jordan.blake@example.com', role: 'member' },
] as const;

/** The contractor whose data the governance demo freezes, then erases. */
export const DEMO_DEPARTING_MEMBER = DEMO_MEMBERS[3];

/** Teams (Settings > Teams). */
export const DEMO_TEAMS: readonly string[] = [
  'Growth',
  'Platform engineering',
  'Customer success',
] as const;

/** REST API keys (Settings > API > REST). Names cap at 32 characters. */
export const DEMO_API_KEYS: readonly string[] = [
  'Production ingest',
  'CI pipeline',
] as const;

/** WebDAV app-passwords (Settings > API > WebDAV). */
export const DEMO_WEBDAV_LABELS: readonly string[] = [
  'MacBook Pro',
  'Design workstation',
] as const;

/** MCP server (Settings > API > MCP). `name` is lowercase alphanumeric + hyphens. */
export const DEMO_MCP_SERVER = {
  name: 'internal-wiki',
  displayName: 'Internal Wiki',
  description: 'Search the Northlight engineering wiki and design decisions.',
  url: 'https://mcp.northlight.example/mcp',
} as const;

/** Per-user custom instructions (Settings > Preferences). Caps at 4000 chars. */
export const DEMO_CUSTOM_INSTRUCTIONS =
  'Write in the direct register from our brand guide: short sentences, no exclamation marks. Use ISO dates and metric units. When you use a document, name the file you took it from.';

/** Enterprise SSO form values (filled, never saved — saving would gate sign-in). */
export const DEMO_SSO_EXAMPLE = {
  issuerUrl: 'https://login.microsoftonline.com/8f2c-northlight/v2.0',
  clientId: '4a17c9e2-63b8-4f0d-9e51-2c7a5d8b1f36',
} as const;

/** Governance > Legal hold: the matter, and the hold placed under it. */
export const DEMO_LEGAL_MATTER = {
  name: 'Northstar contract dispute',
  caseNumber: 'NL-2026-014',
  description:
    'Preservation obligation covering the Northstar engagement and its handover material.',
} as const;

export const DEMO_LEGAL_HOLD_REASON =
  'Preserve all workspace data belonging to the departing contractor while the Northstar dispute is open.';

/** Governance > Data subject requests: the erasure request on file. */
export const DEMO_ERASURE_REQUEST = {
  /** A `governance.dataSubjectRequests.reasonCodes.*` option label. */
  reasonCode: 'consent_withdrawn',
  reason:
    'The contractor withdrew consent when their engagement ended and asked us to erase their workspace data.',
} as const;

/**
 * The AI-provider credential (Settings > AI providers). Its vendor is the
 * offline mock gateway the seed wires up (`docs-demo/providers/e2e-mock.yml`,
 * whose `displayName` MOCK_PROVIDER_DISPLAY_NAME mirrors — the capture
 * sanitizes that rig name out of the published frame); the credential's NAME
 * is what a customer's row shows, so it reads like one.
 */
export const DEMO_PROVIDER_CREDENTIAL = 'Production key';
export const MOCK_PROVIDER_DISPLAY_NAME = 'E2E Mock Gateway';
