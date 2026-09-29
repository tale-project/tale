-- Preserve recurring-task membership after a root or middle task is deleted.
-- The original 0130 pointers are navigation, not durable membership.
-- Nullable paired fields let the previous image keep inserting ordinary tasks.
ALTER TABLE app.tasks
  ADD COLUMN IF NOT EXISTS repeat_series_id text,
  ADD COLUMN IF NOT EXISTS repeat_series_position integer;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'app.tasks'::regclass
      AND conname = 'tasks_repeat_series_membership'
  ) THEN
    ALTER TABLE app.tasks ADD CONSTRAINT tasks_repeat_series_membership CHECK (
      (repeat_series_id IS NULL AND repeat_series_position IS NULL)
      OR (repeat_series_id IS NOT NULL AND repeat_series_position IS NOT NULL
          AND repeat_series_position >= 0)
    );
  END IF;
END $$;

COMMENT ON COLUMN app.tasks.repeat_series_id IS
  'Durable series identity, an opaque task id rather than an FK. Retained through rule edits and task deletion; NULL before a first continuation and on copied subtasks.';
COMMENT ON COLUMN app.tasks.repeat_series_position IS
  'Immutable order within repeat_series_id. Stop may reclaim untouched later copies but preserves this task and its predecessors. NULL exactly when repeat_series_id is NULL.';

CREATE UNIQUE INDEX IF NOT EXISTS tasks_repeat_series_position
  ON app.tasks (org_id, project_id, repeat_series_id, repeat_series_position)
  WHERE repeat_series_id IS NOT NULL;

-- Every 0130 copy wrote a task.created audit record with repeatOf, including
-- copies whose source or intermediate cards were since deleted. Prefer live
-- pointers where present; otherwise accept only unambiguous, well-formed audit
-- ancestry from the same org/project. Deleted ids are opaque nodes, never FK
-- targets. A retained chain can cross them without attaching to another tenant.
-- If both a deleted link and its audit history have gone, their relationship
-- cannot be recovered: keep the surviving components separate, never guess.
-- ALTER TABLE holds the tasks lock through the fill and trigger installation,
-- so no old-image continuation can slip between those two operations.
WITH RECURSIVE live_edges AS MATERIALIZED (
  SELECT source.org_id, source.project_id, copy.id AS child, source.id AS parent
  FROM app.tasks source
  JOIN app.tasks copy ON copy.id = source.repeat_next_task_id
    AND copy.org_id = source.org_id AND copy.project_id = source.project_id
  WHERE source.parent_task_id IS NULL AND copy.parent_task_id IS NULL
    AND source.id <> copy.id
), audit_edges AS MATERIALIZED (
  SELECT a.org_id, a.metadata ->> 'projectId' AS project_id,
         a.resource_id AS child, min(a.metadata ->> 'repeatOf') AS parent
  FROM app.audit_logs a
  JOIN app.projects p ON p.id = a.metadata ->> 'projectId' AND p.org_id = a.org_id
  WHERE a.resource_type = 'task' AND a.action = 'task.created'
    AND a.status = 'success' AND a.resource_id IS NOT NULL
    AND a.metadata -> 'parentTaskId' = 'null'::jsonb
    AND jsonb_typeof(a.metadata -> 'repeatOf') = 'string'
    AND a.metadata ->> 'repeatOf' <> ''
    AND a.metadata ->> 'repeatOf' <> a.resource_id
    AND NOT EXISTS (
      SELECT 1 FROM app.tasks t
      WHERE t.id IN (a.resource_id, a.metadata ->> 'repeatOf')
        AND (t.org_id <> a.org_id OR t.project_id <> p.id OR t.parent_task_id IS NOT NULL)
    )
  GROUP BY a.org_id, a.metadata ->> 'projectId', a.resource_id
  HAVING count(DISTINCT a.metadata ->> 'repeatOf') = 1
), edges AS MATERIALIZED (
  SELECT * FROM live_edges
  UNION ALL
  SELECT a.* FROM audit_edges a
  WHERE NOT EXISTS (
    SELECT 1 FROM live_edges live
    WHERE live.org_id = a.org_id AND live.project_id = a.project_id AND live.child = a.child
  )
), candidates AS MATERIALIZED (
  SELECT t.org_id, t.project_id, t.id
  FROM app.tasks t
  WHERE t.parent_task_id IS NULL
    AND (t.repeat_rule IS NOT NULL OR t.repeat_continued_at_ms IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM edges e WHERE e.org_id = t.org_id AND e.project_id = t.project_id
          AND (e.child = t.id OR e.parent = t.id)
      ))
), nodes AS MATERIALIZED (
  SELECT org_id, project_id, id FROM candidates
  UNION SELECT org_id, project_id, child FROM edges
  UNION SELECT org_id, project_id, parent FROM edges
), rooted (org_id, project_id, origin, series_id, depth) AS (
  -- One traversal per root, including retained ancestry for deleted cards.
  -- Every node has at most one parent, so a root-reachable cycle is impossible.
  -- Ordinary long closed series are linear walks, not one walk per member.
  SELECT n.org_id, n.project_id, n.id, n.id, 0
  FROM nodes n
  WHERE NOT EXISTS (
    SELECT 1 FROM edges e
    WHERE e.org_id = n.org_id AND e.project_id = n.project_id AND e.child = n.id
  )
  UNION ALL
  SELECT r.org_id, r.project_id, e.child, r.series_id, r.depth + 1
  FROM rooted r
  JOIN edges e ON e.org_id = r.org_id AND e.project_id = r.project_id AND e.parent = r.origin
), cyclic (org_id, project_id, origin, node, path, depth) AS (
  -- Only malformed rootless components need a visited path. All legitimate
  -- writers create a new child, so normal data never enters this fallback.
  SELECT c.org_id, c.project_id, c.id, c.id, ARRAY[c.id], 0
  FROM candidates c
  WHERE NOT EXISTS (
    SELECT 1 FROM rooted r
    WHERE r.org_id = c.org_id AND r.project_id = c.project_id AND r.origin = c.id
  )
  UNION ALL
  SELECT a.org_id, a.project_id, a.origin, e.parent, a.path || e.parent, a.depth + 1
  FROM cyclic a
  JOIN edges e ON e.org_id = a.org_id AND e.project_id = a.project_id AND e.child = a.node
  WHERE NOT e.parent = ANY(a.path)
), roots AS (
  SELECT org_id, project_id, origin, depth, series_id FROM rooted
  UNION ALL
  SELECT a.org_id, a.project_id, a.origin, a.depth, (
    SELECT min(member) FROM unnest(a.path[array_position(a.path, e.parent):]) member
  ) AS series_id
  FROM cyclic a
  JOIN edges e ON e.org_id = a.org_id AND e.project_id = a.project_id AND e.child = a.node
  WHERE e.parent = ANY(a.path)
), numbered AS (
  SELECT r.origin, r.series_id,
    (row_number() OVER (
      PARTITION BY r.org_id, r.project_id, r.series_id
      ORDER BY r.depth, t.created_at_ms, t.id
    ) - 1)::integer AS position
  FROM roots r JOIN app.tasks t ON t.id = r.origin
)
UPDATE app.tasks t
SET repeat_series_id = n.series_id, repeat_series_position = n.position
FROM numbered n
WHERE t.id = n.origin AND t.repeat_series_id IS NULL;

-- An old image still publishes a copy by updating its source's pointer after
-- inserting the copy. Assign both memberships in that same write, before any
-- delete can clear a pointer. New images already supply the identical values.
-- This is compatibility for the shipped writer, not another recurrence engine:
-- it changes neither rules, counts, timestamps, hints nor which tasks are copied.
CREATE OR REPLACE FUNCTION app.task_repeat_series_compat()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.repeat_next_task_id IS NULL
     OR NEW.repeat_next_task_id IS NOT DISTINCT FROM OLD.repeat_next_task_id THEN
    RETURN NEW;
  END IF;
  IF NEW.repeat_series_id IS NULL THEN
    NEW.repeat_series_id := NEW.id;
    NEW.repeat_series_position := 0;
  END IF;
  UPDATE app.tasks
  SET repeat_series_id = NEW.repeat_series_id,
      repeat_series_position = NEW.repeat_series_position + 1
  WHERE id = NEW.repeat_next_task_id
    AND org_id = NEW.org_id AND project_id = NEW.project_id
    AND parent_task_id IS NULL AND repeat_series_id IS NULL;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tasks_repeat_series_compat ON app.tasks;
CREATE TRIGGER tasks_repeat_series_compat
  BEFORE UPDATE OF repeat_next_task_id ON app.tasks
  FOR EACH ROW EXECUTE FUNCTION app.task_repeat_series_compat();
