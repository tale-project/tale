-- The project a chat attachment was made in before its thread existed
--
-- A recording added to a project's new chat — uploaded, or fetched from a
-- pasted video link — is transcribed before the chat's first send creates
-- its thread: `thread_id` is still empty when the transcription holds and
-- books its minutes, so the project's budget never saw them. The composer
-- knows the project from the start and names it when it registers the
-- upload or the link; the door checks that the member may chat in it. A
-- transcription reads `file_metadata.project_id` first and the thread's
-- project after it (`files/transcription-metering.ts`); a video link's job
-- hands its project to the audio row it creates.
--
-- Rolling-deploy safe: nullable columns the previous image neither writes
-- nor reads.

ALTER TABLE app.file_metadata ADD COLUMN IF NOT EXISTS project_id text;

ALTER TABLE app.video_link_jobs ADD COLUMN IF NOT EXISTS project_id text;
