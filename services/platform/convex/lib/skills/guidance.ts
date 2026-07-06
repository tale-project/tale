/**
 * Skill-usage guidance for external-agent sessions: the generally-relevant
 * "how to work" workflow from AGENTS.md, rendered ONLY from the skills that
 * are actually available in the session — the prompt never names a skill the
 * agent cannot load. Pure and Convex-free so it unit-tests without the
 * 'use node' staging module that feeds it (node_only/sandbox/workflow_skills).
 */

/** Heading of the generated section — also its idempotency marker: when an
 * agent's own instructions already carry it, the composer drops the generated
 * copy (see agents/external_agent/system_prompt.ts). */
export const SKILLS_GUIDANCE_HEADING = '## Working with skills';

/**
 * The workflow skills stageable into a session, in guidance order. This is
 * the staging allowlist for workflow_skills.ts; every entry must exist under
 * builtin-configs/skills/<name>/ (guarded by guidance.test.ts). review-pr is
 * staged but not a numbered step — reviewing someone else's PR is not part of
 * the do-work loop the guidance encodes.
 */
export const WORKFLOW_SKILL_NAMES: readonly string[] = [
  'write-notes',
  'search-codebase',
  'deep-research',
  'delegate-work',
  'browse-web',
  'implement-feature',
  'make-improvement',
  'implement-ui',
  'design-ui',
  'fix-bug',
  'review-code',
  'review-pr',
  'create-pr',
  'test-code',
];

const INTRO =
  'Skills are named playbooks available in this session — load or invoke the ' +
  'one whose trigger matches (automatic discovery, slash invocation, or the ' +
  'runtime-native skill affordance where one exists). For any coding task, work ' +
  'in this order:';

interface GuidanceStep {
  /** The step renders when ANY of these skills is available. */
  requires: readonly string[];
  render: (available: ReadonlySet<string>) => string;
}

const DISCIPLINES: ReadonlyArray<{ skill: string; line: string }> = [
  {
    skill: 'implement-feature',
    line: 'New behaviour (add, build, support, create) -> implement-feature',
  },
  {
    skill: 'fix-bug',
    line: 'A defect (fix, broken, error, regression) -> fix-bug',
  },
  {
    skill: 'make-improvement',
    line: 'Behaviour-preserving change (refactor, cleanup, simplify) -> make-improvement',
  },
];

// The ordered workflow. Steps gate 1:1 on their skill except the classify
// step (renders the available discipline subset) and the UI step (degrades to
// a single-skill sentence).
const STEPS: readonly GuidanceStep[] = [
  {
    requires: DISCIPLINES.map((d) => d.skill),
    render: (available) =>
      [
        'Classify the task and follow the matching discipline skill end-to-end:',
        ...DISCIPLINES.filter((d) => available.has(d.skill)).map(
          (d) => `   - ${d.line}`,
        ),
      ].join('\n'),
  },
  {
    requires: ['write-notes'],
    render: () =>
      "Write the note first (write-notes): answer the active skill's note form before touching any code.",
  },
  {
    requires: ['deep-research'],
    render: () =>
      'When an unknown blocks a decision, run deep-research before committing to an approach.',
  },
  {
    requires: ['search-codebase'],
    render: () =>
      'Use search-codebase to find the existing concept to reuse before adding anything new, and to sweep every sibling occurrence your change must update.',
  },
  {
    requires: ['design-ui', 'implement-ui'],
    render: (available) => {
      if (!available.has('implement-ui')) {
        return 'When the task touches UI, read design-ui to locate the design system before changing it.';
      }
      if (!available.has('design-ui')) {
        return "When the task touches UI, build to the project's design system with implement-ui.";
      }
      return 'When the task touches UI, read design-ui to locate the design system, then build to it with implement-ui.';
    },
  },
  {
    requires: ['delegate-work'],
    render: () =>
      'When the work splits into independent units, use delegate-work to run them in parallel.',
  },
  {
    requires: ['test-code'],
    render: () =>
      'Prove the behaviour with test-code — observe the real outcome, never just a green typecheck.',
  },
  {
    requires: ['browse-web'],
    render: () =>
      'When verification or research needs a real browser, drive it with browse-web.',
  },
  {
    requires: ['review-code'],
    render: () =>
      'Review your own diff with review-code before declaring the work done.',
  },
  {
    requires: ['create-pr'],
    render: () => 'Ship the finished change with create-pr.',
  },
];

/**
 * Render the guidance section from the skills available in this session.
 * Steps whose skill is absent are dropped and the numbering is recomputed, so
 * the output is deterministic for a given availability set (prompt-cache
 * friendly). Returns '' when no step survives, or when the operator
 * kill-switch TALE_SANDBOX_SKILLS_GUIDANCE=0 is set (same env style as the
 * adapter's TALE_SANDBOX_* switches).
 */
export function buildSkillsGuidance(available: ReadonlySet<string>): string {
  if (process.env.TALE_SANDBOX_SKILLS_GUIDANCE === '0') return '';
  const rendered = STEPS.filter((step) =>
    step.requires.some((name) => available.has(name)),
  ).map((step, index) => `${index + 1}. ${step.render(available)}`);
  if (rendered.length === 0) return '';
  const close = available.has('write-notes')
    ? 'Skip a step only when it clearly does not apply to the task; never skip the note.'
    : 'Skip a step only when it clearly does not apply to the task.';
  return [SKILLS_GUIDANCE_HEADING, INTRO, rendered.join('\n'), close].join(
    '\n\n',
  );
}
