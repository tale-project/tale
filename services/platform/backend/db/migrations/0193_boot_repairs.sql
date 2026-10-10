-- 0.5 app migration 0193: the ledger of one-time boot repairs.
--
-- A repair of Better Auth's own rows cannot be a numbered migration: these
-- files run before Better Auth creates its tables on a fresh database, and
-- the tables are not the app's to reshape. Boot runs such a repair after
-- Better Auth's migrator, under the same migration lock (`db/migrate.ts`),
-- and records its name here so it runs once per database.
CREATE TABLE IF NOT EXISTS app.boot_repairs (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
