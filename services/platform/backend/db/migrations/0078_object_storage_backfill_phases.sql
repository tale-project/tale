-- Blob backfill phases for TTS chunks and video-link blobs.
--
-- The 0053 phase CHECK named only the two tables the first engine walked
-- (`documents`, `file_metadata`). Two more org-owned tables hold `s3:` blob
-- refs of their own — `app.tts_audio_chunks.storage_ref` (synthesized audio)
-- and `app.video_link_jobs.storage_ref` (captions / extracted audio) — so a
-- backfill reported "completed" while every such blob still sat in the
-- deployment default store. The engine now walks them as two more phases;
-- this widens the CHECK so it may stamp them. The constraint carries the
-- name Postgres gave the inline CHECK in 0053.
--
-- Rolling-deploy safe: the previous image is still serving while this applies
-- — it stamps only the old phase values, which stay allowed.
ALTER TABLE app.object_storage_backfill_runs
  DROP CONSTRAINT IF EXISTS object_storage_backfill_runs_phase_check;
ALTER TABLE app.object_storage_backfill_runs
  ADD CONSTRAINT object_storage_backfill_runs_phase_check CHECK (
    phase IN ('documents', 'fileMetadata', 'ttsChunks', 'videoLinks', 'done')
  );
