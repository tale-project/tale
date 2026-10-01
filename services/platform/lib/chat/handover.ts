/**
 * How THIS person hands work to an agent — the one piece of the product the
 * chat assistant cannot know from its instructions, because it differs per
 * person and per organization: which projects they can open have an agent,
 * whether they could add one where there is none, and whether agents can be
 * started at all. Without it the persona could only say "create a task and
 * assign it to an agent", which sent a Member into a project with no agent
 * and a tab they cannot change.
 *
 * The control names are the ones the person's own interface shows, in their
 * language, resolved by the host from the same catalogs the app renders —
 * the model quotes them instead of translating its own guess.
 *
 * Per person, so the block rides after the cache breakpoint (`context.ts`).
 *
 * Layer A: pure data.
 */

/** Projects named in the note: enough to choose from, never a directory. */
const HANDOVER_PROJECTS_NAMED = 5;

export interface TaskHandover {
  /** Projects the person can open that have at least one agent, by name. */
  readonly projectsWithAgents: readonly string[];
  /** How many projects the person can open have none. */
  readonly projectsWithoutAgents: number;
  /** The person may add an agent to at least one project they can open. */
  readonly canAddAgents: boolean;
  /** The organization switched task automation off: agents cannot start. */
  readonly automationOff: boolean;
  /** The organization's standard agent takes work, for this person, in a
   * project with no agent of its own. */
  readonly standardAgent: boolean;
  /** The interface's own words for the controls, in the person's language. */
  readonly labels: {
    /** The chat header's hand-over verb. */
    readonly createTask: string;
    /** The task dialog's verb that creates the task and starts its agent. */
    readonly createAndStart: string;
    /** The task dialog's assignee field. */
    readonly assignee: string;
    /** The assignee list's way to add an agent in place. */
    readonly createAgent: string;
    /** The assignee list's entry for the organization's standard agent. */
    readonly standardAgent: string;
  };
}

const quote = (label: string) => `"${label}"`;

const HEADING =
  'How this person hands work to an agent — use these steps when a request is task work, and quote the control names exactly as written here: they are what this person sees.';

/**
 * The note. A person who can open no project gets one too: the persona
 * defers to it, and without it the model would invent the steps.
 */
export function renderTaskHandover(handover: TaskHandover): string {
  const { labels } = handover;
  const named = handover.projectsWithAgents.slice(0, HANDOVER_PROJECTS_NAMED);
  const unnamed = handover.projectsWithAgents.length - named.length;
  if (named.length === 0 && handover.projectsWithoutAgents === 0) {
    return [
      HEADING,
      'They can open no project yet, so there is nowhere to hand the work to: an Editor or Admin creates a project and shares it with them. Until then, give what fits in a reply.',
    ].join('\n');
  }

  const lines = [
    HEADING,
    `1. In this chat's header, choose ${quote(labels.createTask)}. The task takes their request, the files they shared, and a link back to this chat.`,
  ];
  if (handover.standardAgent && handover.projectsWithoutAgents > 0) {
    // Every project can take the work: those without an agent of their own
    // get the organization's standard agent.
    const others = unnamed > 0 ? ` (and ${unnamed} more)` : '';
    lines.push(
      named.length > 0
        ? `2. Pick the project the work belongs to. ${named.join(', ')}${others} already have agents; in any other project the organization's standard agent (${quote(labels.standardAgent)}) is assigned to the task.`
        : `2. Pick the project the work belongs to. No project they can open has an agent yet, so the organization's standard agent (${quote(labels.standardAgent)}) is assigned to the task.`,
    );
  } else if (named.length > 0) {
    const others = unnamed > 0 ? ` (and ${unnamed} more)` : '';
    lines.push(
      `2. Pick a project with an agent: ${named.join(', ')}${others}. Its agent is assigned when it is the only one.`,
    );
  } else if (handover.canAddAgents) {
    lines.push(
      `2. None of their projects has an agent yet, but they can add one: under ${quote(labels.assignee)} in the task, choose ${quote(labels.createAgent)}.`,
    );
  } else {
    lines.push(
      "2. None of their projects has an agent yet, and they cannot add one: an Editor or Admin adds agents on a project's Agents tab. Until then the task can go to a person.",
    );
  }
  lines.push(
    handover.automationOff
      ? `3. Agents cannot be started in this workspace right now — an Admin turned task automation off. The task can still be created with ${quote(labels.createTask)} and assigned.`
      : `3. Choose ${quote(labels.createAndStart)}. This chat then shows the task's progress above the message box, and they are notified when it is ready for review or when the agent cannot finish.`,
  );
  return lines.join('\n');
}
