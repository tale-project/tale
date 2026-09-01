import type { SearchStrategy } from '../types';

/** Projects are searched by name + description (substring) and `key` — the
 *  immutable short prefix (`TAL`) people actually say out loud and that every
 *  task identifier carries, so `key` is matched as an id rather than as prose.
 *
 *  NOT `activeOnly`: `projects` carries no `lifecycleStatus`; archived projects
 *  are excluded by the caller's `accessFilter` on `archivedAt`, alongside the
 *  per-row `hasProjectAccess` check that team sharing requires.
 *
 *  Swap `engine` to `'searchIndex'` (+ `searchIndexName: 'search_projects'`,
 *  `searchIndexField: 'name'`) once the bootstrap is fixed — that index existed
 *  and was dropped in v0.2.75; see `TODO(search-index-disabled)` in
 *  `projects/queries.ts`. */
export const projectsSearchStrategy: SearchStrategy<'projects'> = {
  table: 'projects',
  orgIndex: 'by_organization',
  textFields: ['name', 'description'],
  idFields: ['key'],
  engine: 'scan',
};
