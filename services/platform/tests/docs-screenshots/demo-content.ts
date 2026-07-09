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

export interface DemoProject {
  readonly name: string;
  readonly tasks: readonly string[];
}

export const DEMO_PROJECTS: readonly DemoProject[] = [
  {
    name: 'Website relaunch',
    tasks: [
      'Finalize homepage copy with marketing',
      'Map legacy URLs to the new structure',
      'Run the accessibility sweep on staging',
      'Prepare the rollback plan',
      'Sign off the launch checklist',
    ],
  },
  {
    name: 'Customer onboarding portal',
    tasks: [
      'Draft the welcome email sequence',
      'Design the progress checklist screen',
      'Wire the CRM webhook for new sign-ups',
      'Review the trial-to-paid handoff flow',
    ],
  },
] as const;

interface DemoDocument {
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

interface DemoDiscussion {
  readonly title: string;
  /** Category key — `discussions.categories.<key>` in messages/en.json. */
  readonly category: string;
  readonly body: string;
}

/** Discussions opened in the "Website relaunch" project. */
export const DEMO_DISCUSSIONS: readonly DemoDiscussion[] = [
  {
    title: 'Keep the legacy blog URLs after relaunch?',
    category: 'decisions',
    body: 'The redirect map covers 340 of 380 legacy URLs. The remaining 40 are old blog posts with almost no traffic — redirect them to the blog index, or keep the pages live?',
  },
  {
    title: 'What counts as launch-blocking in the accessibility sweep?',
    category: 'qa',
    body: 'The staging sweep found 12 issues. Which severity levels block the launch, and which can land in the first week after go-live?',
  },
] as const;

interface DemoKnowledgeEntry {
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
