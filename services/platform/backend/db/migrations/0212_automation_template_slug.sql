-- The catalog template an automation was made from.
--
-- Every automation Tale ships is a template in one catalog; using one saves
-- version 1 of a new automation, and the catalog counts, per template, the
-- automations of the organization made from it ("In use"). That fact needs a
-- home outside the version's `presentation`: the presentation is a strict JSON
-- shape, and an image that meets a key it does not know reads the whole
-- presentation as none — the automation would lose its display name and the
-- Inbox view a mail sync opens, after a rollback or in a tab an older image
-- serves.
--
--   template_slug  the catalog slug of the template the automation was made
--                  from (`gmail/sync-emails`, `task-digest`); written on
--                  version 1 by the create and carried onto every later
--                  version, so the retention of old versions keeps it. NULL
--                  for an automation made any other way, and for every version
--                  saved before templates or by an image that predates them.
--
-- Rolling-deploy safe: the previous image neither reads nor writes the new
-- nullable column; a version it saves leaves it NULL, and the count reads the
-- slug of any version of the automation.

ALTER TABLE app.automations
  ADD COLUMN IF NOT EXISTS template_slug text
  CONSTRAINT automations_template_slug_check CHECK (
    template_slug IS NULL
    OR (
      char_length(template_slug) BETWEEN 1 AND 200
      AND template_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*){0,3}$'
    )
  );

-- A version whose presentation carries the slug itself (`template`, written
-- before the slug had this column) moves it here and drops it from the
-- presentation, which every image then reads again. A value the column would
-- refuse is dropped, not moved.
UPDATE app.automations
   SET template_slug = COALESCE(
         template_slug,
         CASE
           WHEN char_length(presentation ->> 'template') BETWEEN 1 AND 200
            AND presentation ->> 'template'
                ~ '^[a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*){0,3}$'
           THEN presentation ->> 'template'
         END
       ),
       presentation = presentation - 'template'
 WHERE jsonb_typeof(presentation) = 'object'
   AND presentation ? 'template';
