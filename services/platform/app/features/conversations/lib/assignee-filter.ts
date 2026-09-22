import type { FilterOption } from '@tale/ui/filters/filter-panel';

/**
 * The Inbox's assignee facet. A conversation carries two independent stamps —
 * `assigneeUserId` (the person who owns it) and `assigneeTeamId` (the team
 * queue it waits in) — and both can be set at once. One facet covers both, so
 * "who is this waiting on" is a single question whatever the answer is.
 *
 * The three sentinels below are never real ids; they read the stamps against
 * the VIEWER rather than against a fixed value.
 */

/** Assigned to the viewer personally. */
export const ASSIGNEE_ME = '__me__';
/** Neither stamp set — administrator triage. */
export const ASSIGNEE_UNASSIGNED = '__unassigned__';
/** Queued to any team the viewer belongs to. */
export const ASSIGNEE_MY_TEAMS = '__my-teams__';

/** The two assignment stamps, the only part of a row this module reads. */
export interface AssignedRow {
  assigneeUserId?: string;
  assigneeTeamId?: string;
}

export interface AssigneeViewer {
  /** Undefined while the member context loads, which makes `ASSIGNEE_ME` match nothing. */
  currentUserId?: string;
  myTeamIds: ReadonlySet<string>;
}

/**
 * Whether a row survives the facet. Selected values are OR-ed: picking two
 * people shows both people's conversations, and picking a person plus a team
 * shows either. An empty selection narrows nothing.
 */
export function matchesAssigneeFilter(
  row: AssignedRow,
  selected: readonly string[],
  viewer: AssigneeViewer,
): boolean {
  if (selected.length === 0) return true;

  return selected.some((value) => {
    if (value === ASSIGNEE_UNASSIGNED) {
      return (
        row.assigneeUserId === undefined && row.assigneeTeamId === undefined
      );
    }
    if (value === ASSIGNEE_ME) {
      return (
        viewer.currentUserId !== undefined &&
        row.assigneeUserId === viewer.currentUserId
      );
    }
    if (value === ASSIGNEE_MY_TEAMS) {
      return (
        row.assigneeTeamId !== undefined &&
        viewer.myTeamIds.has(row.assigneeTeamId)
      );
    }
    // A bare id can name either dimension, and the caller cannot know which
    // without a directory lookup. Matching both is what the option promised:
    // one entry per name, whether that name is a person or a team.
    return row.assigneeUserId === value || row.assigneeTeamId === value;
  });
}

export interface AssigneeOptionInput {
  /** The loaded rows. Options come from the assignees actually in the inbox. */
  rows: readonly AssignedRow[];
  /** Currently selected values, so a reloaded URL keeps its option visible. */
  selected: readonly string[];
  personNameOf: (userId: string) => string | undefined;
  teamNameOf: (teamId: string) => string | undefined;
  labels: {
    people: string;
    teams: string;
    unknownPerson: string;
    unknownTeam: string;
  };
}

/**
 * The facet's people and teams, grouped and sorted by name.
 *
 * Options are derived from the loaded rows rather than from the member
 * directory: an organization with forty members and three of them in the inbox
 * offers three names, not forty that mostly filter to nothing. A selected value
 * is always kept as an option even after it leaves the loaded set, so a
 * reloaded link never shows an empty panel over a narrowed list.
 *
 * Sentinels are the caller's to prepend — they depend on the viewer's role and
 * teams, which this module does not read.
 */
export function buildAssigneeOptions({
  rows,
  selected,
  personNameOf,
  teamNameOf,
  labels,
}: AssigneeOptionInput): FilterOption[] {
  const personIds = new Set<string>();
  const teamIds = new Set<string>();

  for (const row of rows) {
    if (row.assigneeUserId !== undefined) personIds.add(row.assigneeUserId);
    if (row.assigneeTeamId !== undefined) teamIds.add(row.assigneeTeamId);
  }

  // A selected id that has left the loaded rows still needs its option. The
  // rows no longer say which dimension it named, so the team directory decides:
  // it holds every team of the organization for any member.
  for (const value of selected) {
    if (value.startsWith('__')) continue;
    if (personIds.has(value) || teamIds.has(value)) continue;
    if (teamNameOf(value) === undefined) personIds.add(value);
    else teamIds.add(value);
  }

  const toOptions = (
    ids: ReadonlySet<string>,
    nameOf: (id: string) => string | undefined,
    unknown: string,
    group: string,
  ): FilterOption[] =>
    [...ids]
      .map((id) => ({ value: id, label: nameOf(id) ?? unknown, group }))
      .sort((a, b) => a.label.localeCompare(b.label));

  return [
    ...toOptions(personIds, personNameOf, labels.unknownPerson, labels.people),
    ...toOptions(teamIds, teamNameOf, labels.unknownTeam, labels.teams),
  ];
}
