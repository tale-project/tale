import { z } from 'zod';

import { epochMsSchema } from './epoch-ms';

/** The last observed upstream issue, separate from a person's Tale edits.
 * `id` is vendor-stable (never a repository name, project slug, or title). */
export const taskExternalIssueSchema = z
  .object({
    id: z.string().trim().min(1).max(2000),
    title: z.string().min(1).max(10000),
    description: z.string().max(100000),
    url: z.url({ protocol: /^https?$/ }).max(4000),
    state: z.enum(['open', 'closed', 'resolved', 'ignored']),
    updatedAt: z.iso.datetime({ offset: true }).optional(),
    // A valid stored timestamp must remain renderable by every task card.
    syncedAt: epochMsSchema,
    unavailable: z.boolean().optional(),
    repositoryId: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
    sourceProjectId: z.string().trim().min(1).max(2000).optional(),
    number: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  })
  .strict();

export type TaskExternalIssue = z.infer<typeof taskExternalIssueSchema>;

/** What Tale knows of one tracker the issue sync reads. */
export interface IssueTrackerRules {
  /** The snapshot field that names the listing an issue was read from: the
   * repository on a code host, the project on an error tracker. */
  scope: 'repositoryId' | 'sourceProjectId';
  /** Two locators that differ only in case name one issue: a code host's
   * `owner/repo` is case-insensitive, a GlitchTip project slug is not. */
  foldsCase: boolean;
  /** Each connection names its own instance, whose origin begins the
   * snapshot's id (`<origin>#<id>`). */
  perInstance: boolean;
}

/** The `externalSystem` names of the trackers the issue sync reads. */
export const ISSUE_TRACKER_SYSTEMS = [
  'github',
  'github-security',
  'forgejo',
  'glitchtip',
] as const;

export type IssueTrackerSystem = (typeof ISSUE_TRACKER_SYSTEMS)[number];

/**
 * The trackers the issue sync writes tasks for, by the `externalSystem`
 * their tasks carry. A task from one of them is a mirror of that tracker's
 * issue: its upstream state is evidence, never the task's lifecycle; the
 * `@names` in its text are the tracker's people; and it has no
 * source-declared status form.
 */
export const ISSUE_TRACKERS: Readonly<
  Record<IssueTrackerSystem, IssueTrackerRules>
> = {
  github: { scope: 'repositoryId', foldsCase: true, perInstance: false },
  'github-security': {
    scope: 'repositoryId',
    foldsCase: true,
    perInstance: false,
  },
  forgejo: { scope: 'repositoryId', foldsCase: true, perInstance: true },
  glitchtip: { scope: 'sourceProjectId', foldsCase: false, perInstance: true },
};

/** The tracker an `externalSystem` names, or null for any other source —
 * matched as written; lower-case it first where a door folds case. */
export function issueTracker(
  externalSystem: string | null | undefined,
): IssueTrackerRules | null {
  const system = ISSUE_TRACKER_SYSTEMS.find(
    (known) => known === externalSystem,
  );
  return system === undefined ? null : ISSUE_TRACKERS[system];
}

/** Whether an `externalSystem` names a tracker the issue sync reads. */
export function isIssueTrackerSystem(
  externalSystem: string | null | undefined,
): externalSystem is IssueTrackerSystem {
  return issueTracker(externalSystem) !== null;
}

/** The trackers whose snapshots name their listing by `scope`. */
export function issueTrackersScopedBy(
  scope: IssueTrackerRules['scope'],
): IssueTrackerSystem[] {
  return ISSUE_TRACKER_SYSTEMS.filter(
    (system) => ISSUE_TRACKERS[system].scope === scope,
  );
}

/** The listing an issue snapshot was read from, as the task keeps it among
 * its source scopes: its repository or project id, by the tracker's rule. */
export function issueSourceScope(
  externalSystem: string,
  issue: TaskExternalIssue,
): string | undefined {
  const tracker = issueTracker(externalSystem);
  if (tracker === null) return undefined;
  return tracker.scope === 'repositoryId'
    ? issue.repositoryId?.toString()
    : issue.sourceProjectId;
}

/** The path a pull request's link ends in, on every tracker the sync reads
 * them from (`/pull/<n>` on GitHub, `/pulls/<n>` on Forgejo); an issue's
 * ends in `/issues/<n>`. */
export const PULL_REQUEST_PATH = /\/pulls?\/[1-9][0-9]*$/;

/** Whether a snapshot's link is a pull request's rather than an issue's. */
export function isPullRequestUrl(url: string): boolean {
  return PULL_REQUEST_PATH.test(new URL(url).pathname);
}
