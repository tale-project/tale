/**
 * The Teams filter every audience-scoped list (documents, projects) offers —
 * by AUDIENCE, not by "current team": the organization-wide rows, the rows
 * any of the viewer's own teams may see, and each team by name. A row
 * matches when it satisfies ANY selected value.
 *
 * The selection travels as plain strings (a URL search param carries it):
 * team ids plus the two tokens below, which no team id can collide with.
 */

/** Rows with no team — visible to the whole organization. */
export const ORG_WIDE_AUDIENCE = 'org';
/** Rows carrying any of the viewer's own teams. */
export const MY_TEAMS_AUDIENCE = 'mine';

/** Parse the URL spelling (`a,b,org`) into the selection; blanks dropped. */
export function parseAudienceFilter(value: string | undefined): string[] {
  if (value === undefined || value.length === 0) return [];
  return value.split(',').filter((entry) => entry.length > 0);
}

/** The URL spelling of a selection; `undefined` when nothing is selected. */
export function serializeAudienceFilter(
  selected: readonly string[],
): string | undefined {
  return selected.length > 0 ? selected.join(',') : undefined;
}

/**
 * The predicate over a row's audience (`teamIds`; empty = organization-wide)
 * for one selection and one viewer.
 */
export function audienceMatcher(
  selected: readonly string[],
  myTeamIds: readonly string[],
): (teamIds: readonly string[] | undefined) => boolean {
  const wantOrgWide = selected.includes(ORG_WIDE_AUDIENCE);
  const wantMine = selected.includes(MY_TEAMS_AUDIENCE);
  const named = new Set(
    selected.filter(
      (value) => value !== ORG_WIDE_AUDIENCE && value !== MY_TEAMS_AUDIENCE,
    ),
  );
  const mine = new Set(myTeamIds);
  return (teamIds) => {
    const ids = teamIds ?? [];
    if (ids.length === 0) return wantOrgWide;
    if (wantMine && ids.some((id) => mine.has(id))) return true;
    return ids.some((id) => named.has(id));
  };
}
