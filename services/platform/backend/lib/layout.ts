/**
 * Where the backend finds the files it reads beside its code.
 *
 * The backend runs in two shapes. From its TypeScript sources (`bun run dev`,
 * the tests, the dev image), each module sits where the repository has it.
 * From the build (`bun run backend:build`, the production image), every
 * module is folded into the files of one flat directory, `backend-dist/`,
 * beside `backend/` — so a path worked out from a module's own location
 * means something else there. This module is the one place that knows both
 * shapes; anything that reads a file by location asks it.
 *
 * A source module is a `.ts` file and a built one is `.js`, so the module
 * reads its shape off its own URL: nothing to configure, and nothing that can
 * disagree with the files on disk.
 */

/** True when this code runs from the built backend, false from its sources. */
export const BUILT = !import.meta.url.endsWith('.ts');

/**
 * The platform's root: `services/platform` in a checkout, `/app` in the
 * image. The built backend is one directory below it (`backend-dist/`), this
 * source file two (`backend/lib/`).
 */
export const PLATFORM_ROOT = new URL(BUILT ? '../' : '../../', import.meta.url);

/**
 * The boot migrations. The sources keep them in `backend/db/migrations/`; the
 * build copies the `.sql` files to `backend-dist/migrations/` and puts each
 * data migration there compiled, as `<name>.js`.
 */
export const MIGRATIONS_DIR = new URL(
  BUILT ? './migrations/' : '../db/migrations/',
  import.meta.url,
);

/** The extension a data migration has on disk: compiled in the build. */
const DATA_MIGRATION_EXTENSION = BUILT ? '.js' : '.ts';

/**
 * The file that holds a migration, given the name it is recorded under. A
 * migration keeps one name in `app_migrations` whichever shape applies it —
 * its source file's — so a data migration recorded as `0128_x.ts` is read
 * from `0128_x.js` in the build.
 */
export function migrationFileOnDisk(name: string): string {
  return name.endsWith('.ts')
    ? `${name.slice(0, -'.ts'.length)}${DATA_MIGRATION_EXTENSION}`
    : name;
}

/**
 * The name a file of the migrations directory is recorded under, or null when
 * it is no migration: a `.sql` file under its own name, a compiled data
 * migration under its source's.
 */
export function builtMigrationName(file: string): string | null {
  if (file.endsWith('.sql')) return file;
  if (file.endsWith('.js')) return `${file.slice(0, -'.js'.length)}.ts`;
  return null;
}
