/**
 * The task brief — what an agent turn is told about the task it works on.
 *
 * One composer for both engines a task run can execute on: the native turn
 * (the same loop a chat reply runs on) and the full workspace (a coding
 * agent in a sandbox). The facts and their order are the same — the task's
 * title, project, labels and description, the discussion so far, what sent
 * it back or who started it, what a lighter pass handed over, the files it
 * can read — and so is the closing instruction. Only two things belong to
 * the engine and are passed in already worded: how the task's files reach
 * the agent (a staged directory, or refs its tools read) and how its
 * deliverables leave it (a delivery box, or the tools that make files).
 *
 * Layer A: pure data.
 */

/** The facts of a task a brief states. */
export interface TaskBriefFacts {
  readonly title: string;
  readonly description?: string;
  readonly labels?: readonly string[];
  /** The task's key in its project, e.g. `WR-12`. */
  readonly identifier?: string;
  readonly projectName?: string;
  /** The task's discussion, oldest first. */
  readonly discussion?: ReadonlyArray<{
    readonly author: 'user' | 'agent';
    readonly body: string;
  }>;
}

/**
 * Who put the agent to work when no person pressed Start: an automation's
 * `task.start_agent` step or another agent of the project. The brief names
 * it, and says the message it passed comes from an automation or an agent —
 * never from a person's review, which a person still gives at In review.
 */
export interface TaskRequester {
  readonly kind: 'automation' | 'agent';
  /** The automation's name, or the agent's display name. */
  readonly name: string;
}

/**
 * What a lighter pass of the same run handed to the full workspace: why it
 * could not carry on, and the brief it wrote for its successor.
 */
export interface TaskHandoff {
  readonly reason: string;
  readonly brief: string;
}

function requesterPhrase(requester: TaskRequester): string {
  return requester.kind === 'automation'
    ? `the automation "${requester.name}"`
    : `${requester.name}, another agent of this project,`;
}

/** The line that says who started a run no person started, when it carried
 * no message of its own. */
export function requesterStartLine(requester: TaskRequester): string {
  return (
    `This run was started by ${requesterPhrase(requester)} rather than by a ` +
    'person.'
  );
}

/** The message an automation or an agent passed, phrased as theirs: it
 * leads the work, but a person's word — the description, a comment —
 * outranks it. */
export function requesterFeedbackSection(
  requester: TaskRequester,
  feedbackText: string,
): string {
  return (
    `This run was started by ${requesterPhrase(requester)} with this ` +
    `message — address it before anything else:\n${feedbackText}\n\n` +
    `It comes from ${requester.kind === 'automation' ? 'an automation' : 'an agent'}, ` +
    'not from a person: where it contradicts the task description or a ' +
    "person's comment, those win."
  );
}

/** The handover a lighter pass wrote, as its successor reads it. */
export function handoffSection(handoff: TaskHandoff): string {
  return [
    'An earlier pass of this run — a lightweight one, without a workspace — handed the task over to you because it could not finish it there:',
    handoff.reason.trim(),
    'Its brief for you:',
    handoff.brief.trim(),
    'Whatever files it already made are attached to the task as deliverables. Carry on from there; do not redo what is done.',
  ].join('\n\n');
}

/**
 * The discussion without its closing entry when that entry IS the feedback
 * the run was kicked with: the feedback section says it, so the discussion
 * does not say it twice.
 */
export function discussionBeforeFeedback<
  T extends { readonly author: 'user' | 'agent'; readonly body: string },
>(discussion: readonly T[], feedbackText: string): readonly T[] {
  const last = discussion.at(-1);
  if (
    feedbackText !== '' &&
    last?.author === 'user' &&
    last.body.trim() === feedbackText
  ) {
    return discussion.slice(0, -1);
  }
  return discussion;
}

/** A file a task holds, named for a turn that reads files by ref. */
export interface TaskFileRef {
  readonly ref: string;
  readonly name: string;
}

/**
 * How the task's files reach a native turn: nothing is staged on a disk, so
 * each file is named with the ref its tools read it by. `run_code` copies a
 * file into the light sandbox when its ref is among the call's `files`.
 * Absent when the task holds no file.
 */
export function nativeInputsBlock(files: {
  readonly attachments: readonly TaskFileRef[];
  readonly outputs: readonly TaskFileRef[];
  /** Older deliverables the task keeps but this brief leaves out. */
  readonly omittedOutputs?: number;
}): string | undefined {
  const line = (file: TaskFileRef) => `- ${file.name} (ref: ${file.ref})`;
  const omitted = files.omittedOutputs ?? 0;
  if (files.attachments.length === 0 && files.outputs.length === 0) {
    return undefined;
  }
  return [
    'Task files — to read one, pass its ref in the `files` of a run_code call; it is copied to /agent/inputs/ before the program runs:',
    ...(files.attachments.length > 0
      ? ['Attached to the task by its people:', ...files.attachments.map(line)]
      : []),
    ...(files.outputs.length > 0
      ? [
          "The task's current deliverables, made by earlier runs:",
          ...files.outputs.map(line),
          ...(omitted > 0
            ? [
                `${omitted} older deliverables stay on the task and are left out here.`,
              ]
            : []),
          'To revise a deliverable, start from its copy and make the updated file under the SAME file name — it replaces the previous version on the task.',
        ]
      : []),
  ].join('\n');
}

/** How a native turn's deliverables leave it: through the tools that make
 * files. */
export const NATIVE_DELIVERY =
  'Deliverables: make every file you produce with a tool — create_file, generate_image, or run_code writing to /agent/output/. Each file you make is attached to this task when you finish; a file only in your reply text is not.';

/** The instruction every brief ends on. */
export const TASK_REPORT_INSTRUCTION =
  'When you are done, end with a short report of what you did and what you produced — that report is posted back to the task for human review.';

export interface ComposeTaskBriefArgs {
  readonly brief: TaskBriefFacts;
  /** The comment (or reviewer feedback) that kicked this run. */
  readonly feedback?: string;
  readonly requester?: TaskRequester;
  readonly handoff?: TaskHandoff;
  /** How the task's files reach the agent, worded by the engine. */
  readonly inputsBlock?: string;
  /** How the agent's deliverables leave it, worded by the engine. */
  readonly delivery?: string;
}

/** A fresh conversation's brief: the facts, then what the engine adds. */
export function composeTaskBrief(args: ComposeTaskBriefArgs): string {
  const { brief } = args;
  const heading =
    brief.identifier !== undefined
      ? `You are working on task ${brief.identifier}: ${brief.title}`
      : `You are working on this task: ${brief.title}`;
  const feedbackText = args.feedback?.trim() ?? '';
  const discussion = discussionBeforeFeedback(
    brief.discussion ?? [],
    feedbackText,
  );
  return [
    heading,
    ...(brief.projectName !== undefined
      ? [`Project: ${brief.projectName}`]
      : []),
    ...(brief.labels !== undefined && brief.labels.length > 0
      ? [`Labels: ${brief.labels.join(', ')}`]
      : []),
    ...(brief.description !== undefined && brief.description !== ''
      ? [`Description:\n${brief.description}`]
      : []),
    ...(discussion.length > 0
      ? [
          [
            'Task discussion so far (oldest first — earlier runs of you posted the agent messages):',
            ...discussion.map(
              (entry) =>
                `${entry.author === 'user' ? 'User' : 'You (an earlier run)'}: ${entry.body}`,
            ),
          ].join('\n\n'),
        ]
      : []),
    ...(feedbackText !== ''
      ? [
          args.requester !== undefined
            ? requesterFeedbackSection(args.requester, feedbackText)
            : `The task was sent back with reviewer feedback — address it before anything else:\n${feedbackText}`,
        ]
      : args.requester !== undefined
        ? [requesterStartLine(args.requester)]
        : []),
    ...(args.handoff !== undefined ? [handoffSection(args.handoff)] : []),
    ...(args.inputsBlock !== undefined ? [args.inputsBlock] : []),
    ...(args.delivery !== undefined ? [args.delivery] : []),
    TASK_REPORT_INSTRUCTION,
  ].join('\n\n');
}
