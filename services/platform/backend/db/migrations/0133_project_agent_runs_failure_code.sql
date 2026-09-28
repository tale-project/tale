-- A failed task-agent run keeps WHY it failed as a stable code, beside its
-- sentence.
--
-- The turn host classified every failure (`TaskRunFailureCode`: a harness
-- error, a start that never launched, a burned deadline, …) only to decide
-- whether the failed mark arms an auto-retry; the code itself was dropped.
-- The retry now reads it back from the task's run history: a
-- `credential_rotated` failure — the vendor answered 401 because the
-- subscription broker refreshed the account under the running turn — resumes
-- on a fresh vend without counting toward the crash-loop budget and without
-- excluding the account from the next vend, up to two in a row
-- (`freeCredentialRotations` in `backend/core/tasks/task_auto_retry.ts`).
-- Both readers, the retry job and the kick plan, need the code on every row
-- of the streak, not just on the one that armed the retry.
--
-- Nullable, no backfill: a run failed before this release keeps its sentence
-- and no code, which both readers take as an ordinary failure. No CHECK: the
-- producer's vocabulary grows with the host, and a code the reader does not
-- know is ordinary too. Rolling-deploy safe: the previous image neither reads
-- nor writes the column (its failed mark names its columns), and its retry
-- keeps counting every failure, as it did.

ALTER TABLE app.project_agent_runs
  ADD COLUMN IF NOT EXISTS failure_code text;
