import { useMemo } from 'react';

import {
  type ProjectChoice,
  useNamedProjects,
} from '@/app/features/projects/hooks/queries';

const NO_PROJECT_IDS: readonly string[] = [];
const NO_PROJECTS: readonly ProjectChoice[] = [];

/**
 * The projects an automation is installed in, by name: where a run it starts
 * may act. Each is read by id rather than out of every project (#5204); an
 * archived one is left out, and none is named until every name is read, so a
 * screen never states part of the set as the whole.
 */
export function useBoundProjects(
  organizationId: string,
  boundIds: readonly string[] | undefined,
): readonly ProjectChoice[] {
  const named = useNamedProjects(organizationId, boundIds ?? NO_PROJECT_IDS);
  return useMemo(
    () =>
      named.isPending
        ? NO_PROJECTS
        : [...named.projects.values()]
            .filter((project) => project.archivedAt === undefined)
            .sort((a, b) => a.name.localeCompare(b.name)),
    [named],
  );
}
