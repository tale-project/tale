/**
 * A project's audience — the teams that can reach it, and with it its agents
 * and its chats: its `teamIds`, else the legacy owning + shared pair. Empty
 * means everyone in the organization.
 */
export function projectTeamIds(project: {
  teamIds?: string[];
  teamId?: string | null;
  sharedWithTeamIds?: string[];
}): string[] {
  if (project.teamIds !== undefined) return project.teamIds;
  return [
    ...(project.teamId ? [project.teamId] : []),
    ...(project.sharedWithTeamIds ?? []),
  ];
}
