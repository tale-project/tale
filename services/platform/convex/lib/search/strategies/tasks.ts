import type { SearchStrategy } from '../types';

/** Tasks are searched by title + description (substring) and `externalId`
 *  (exact / substring), so a task synced from an issue tracker is reachable by
 *  its foreign key as well as its words. `labelIds` holds `taskLabels` ids
 *  rather than text, so there is nothing to put in `arrayTextFields`.
 *
 *  NOT `activeOnly`: `tasks` carries no `lifecycleStatus`, so the flag would be
 *  a silent no-op (`isActiveRow` treats a missing field as active). Archived
 *  tasks are excluded by the caller's `accessFilter` on `archivedAt` — which is
 *  also where project-visibility narrowing belongs, since a task inherits its
 *  project's ACL and has none of its own.
 *
 *  Swap `engine` to `'searchIndex'` (+ `searchIndexName: 'search_tasks'`,
 *  `searchIndexField: 'title'`) once the bootstrap is fixed — see
 *  `TODO(search-index-disabled)`. */
export const tasksSearchStrategy: SearchStrategy<'tasks'> = {
  table: 'tasks',
  // NOT `by_organizationId` — the tasks table names it `by_organization`, and
  // `scopedSubstringSearch` @ts-expect-errors its `withIndex` call, so a wrong
  // name here fails at runtime with no type error to catch it.
  orgIndex: 'by_organization',
  textFields: ['title', 'description'],
  idFields: ['externalId'],
  engine: 'scan',
};
