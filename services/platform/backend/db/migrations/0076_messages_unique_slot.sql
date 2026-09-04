-- One row per (thread, order, step) slot in app.messages.
--
-- The message store orders a thread by ("order", step_order), and every
-- appender claims `max("order") + 1` — a read followed by a write. Under
-- READ COMMITTED two concurrent appends to one thread read the same max and
-- both land on it; the rows then TIE: readers sort them arbitrarily, a branch
-- fork "up to this order" copies both, and nothing ever corrects it. The slot
-- is now UNIQUE, so the second appender is refused at the index and re-claims
-- the next slot (`domains/threads/store.ts`, `domains/chat/store.ts` —
-- `INSERT … ON CONFLICT DO NOTHING` plus a bounded retry).
--
-- Existing ties are repaired FIRST, deterministically and without deleting a
-- row: within every (thread_id, "order") group that holds a tie, the rows are
-- renumbered 0..n-1 by (step_order, created_at_ms, id). That keeps the order
-- readers already observe (step first, then arrival) and touches only the
-- step numbers of rows in affected groups — every other row keeps its slot.
--
-- Rolling-deploy safe: the previous image is still serving while this applies.
-- Its appenders carry no ON CONFLICT clause, so a race it loses during the
-- roll answers an error for that one send instead of writing a tie — strictly
-- better than the corruption, and gone once the new image serves.

WITH tied_groups AS (
  SELECT DISTINCT thread_id, "order"
  FROM app.messages
  GROUP BY thread_id, "order", step_order
  HAVING count(*) > 1
),
renumbered AS (
  SELECT m.id,
         row_number() OVER (
           PARTITION BY m.thread_id, m."order"
           ORDER BY m.step_order, m.created_at_ms, m.id
         ) - 1 AS step_order
  FROM app.messages m
  JOIN tied_groups g ON g.thread_id = m.thread_id AND g."order" = m."order"
)
UPDATE app.messages m
SET step_order = r.step_order
FROM renumbered r
WHERE m.id = r.id AND m.step_order <> r.step_order;

-- The unique slot replaces the plain ordering index: same columns, so every
-- (thread_id, "order", step_order) read keeps its plan.
CREATE UNIQUE INDEX IF NOT EXISTS messages_thread_slot
  ON app.messages (thread_id, "order", step_order);

DROP INDEX IF EXISTS app.messages_thread_order;
