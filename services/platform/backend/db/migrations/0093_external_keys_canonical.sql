-- Caller-owned external keys stored in one canonical form (NFC, trimmed).
--
-- The machine door dedupes on keys the caller owns: a project's
-- `external_item_id` (`projects_org_external_item`, 0008) and a task's
-- (`external_system`, `external_id`) pair (`tasks_project_external_unique`,
-- 0059). Both were compared byte for byte: a key handed over in NFD by a
-- macOS filesystem did not find the project a worker created in NFC from a
-- CSV (the 409 never fired and two visually identical projects existed),
-- and a task id pasted with a trailing newline was a second task where the
-- project door had already trimmed it. The domains now canonicalize every
-- key before a lookup or a write — `canonicalExternalKey`: Unicode NFC,
-- then trimmed — and this file brings the stored rows to that form so the
-- canonical lookups find what was created before it.
--
-- Twins stay distinct: a row whose canonical form another row of the same
-- scope already holds (byte-exact, or as ITS canonical form — the oldest
-- of a group keeps the canonical spelling) is left untouched, so the unique
-- indexes are never violated and no data is merged or lost. Such a row is
-- still reachable by its id and in the project listing; only the lookup by
-- key resolves to the canonical twin. The boot runner swallows notices, so
-- the twins are not logged here — `SELECT … WHERE external_item_id <>
-- normalize(external_item_id, NFC)` lists them.
--
-- Trimming: `[[:space:]]` at both ends (ASCII whitespace and the Unicode
-- spaces the C library knows), the closest SQL twin of JavaScript's
-- `trim()`. `normalize()` needs PostgreSQL 13 and a UTF-8 server encoding.
-- Idempotent and bounded: a second run changes no row.
--
-- Rolling-deploy safe: the previous image compares bytes and keeps
-- finding every row it created (the door trimmed `external_item_id`
-- already; a key it stored in NFD is now stored in NFC, which it did not
-- look up by anyway).

-- Projects: external_item_id, unique per organization.
UPDATE app.projects AS p
SET external_item_id = c.canon
FROM (
  SELECT id,
         org_id,
         created_at_ms,
         regexp_replace(
           normalize(external_item_id, NFC),
           '^[[:space:]]+|[[:space:]]+$', '', 'g'
         ) AS canon
  FROM app.projects
  WHERE external_item_id IS NOT NULL
) AS c
WHERE p.id = c.id
  AND c.canon <> p.external_item_id
  AND c.canon <> ''
  -- another row of the organization already holds the canonical bytes
  AND NOT EXISTS (
    SELECT 1 FROM app.projects q
    WHERE q.org_id = c.org_id AND q.id <> c.id
      AND q.external_item_id = c.canon
  )
  -- an OLDER row of the organization canonicalizes to the same key
  AND NOT EXISTS (
    SELECT 1 FROM app.projects q
    WHERE q.org_id = c.org_id AND q.id <> c.id
      AND q.external_item_id IS NOT NULL
      AND regexp_replace(
            normalize(q.external_item_id, NFC),
            '^[[:space:]]+|[[:space:]]+$', '', 'g'
          ) = c.canon
      AND (q.created_at_ms < c.created_at_ms
        OR (q.created_at_ms = c.created_at_ms AND q.id < c.id))
  );

-- Tasks: (external_system, external_id), unique per project.
UPDATE app.tasks AS t
SET external_system = c.canon_system,
    external_id = c.canon_id
FROM (
  SELECT id,
         project_id,
         created_at_ms,
         regexp_replace(
           normalize(external_system, NFC),
           '^[[:space:]]+|[[:space:]]+$', '', 'g'
         ) AS canon_system,
         regexp_replace(
           normalize(external_id, NFC),
           '^[[:space:]]+|[[:space:]]+$', '', 'g'
         ) AS canon_id
  FROM app.tasks
  WHERE external_system IS NOT NULL AND external_id IS NOT NULL
) AS c
WHERE t.id = c.id
  AND (c.canon_system <> t.external_system OR c.canon_id <> t.external_id)
  AND c.canon_system <> ''
  AND c.canon_id <> ''
  -- another task of the project already holds the canonical pair
  AND NOT EXISTS (
    SELECT 1 FROM app.tasks q
    WHERE q.project_id = c.project_id AND q.id <> c.id
      AND q.external_system = c.canon_system
      AND q.external_id = c.canon_id
  )
  -- an OLDER task of the project canonicalizes to the same pair
  AND NOT EXISTS (
    SELECT 1 FROM app.tasks q
    WHERE q.project_id = c.project_id AND q.id <> c.id
      AND q.external_system IS NOT NULL AND q.external_id IS NOT NULL
      AND regexp_replace(
            normalize(q.external_system, NFC),
            '^[[:space:]]+|[[:space:]]+$', '', 'g'
          ) = c.canon_system
      AND regexp_replace(
            normalize(q.external_id, NFC),
            '^[[:space:]]+|[[:space:]]+$', '', 'g'
          ) = c.canon_id
      AND (q.created_at_ms < c.created_at_ms
        OR (q.created_at_ms = c.created_at_ms AND q.id < c.id))
  );
