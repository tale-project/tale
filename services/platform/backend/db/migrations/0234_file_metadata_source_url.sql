-- The address a conversation file was fetched from. `web_fetch` keeps a
-- document it read from a link as a file of the conversation (source `web`),
-- so a tool that takes files can change it as it changes an upload; this
-- column names where its bytes came from, so the file reads as fetched from
-- that address rather than as something the person attached, and the same
-- address fetched again with the same bytes finds the file already kept.
--
-- It stays empty for every other file, which is what the previous image keeps
-- writing while a deployment rolls: it never names the column.
ALTER TABLE app.file_metadata
  ADD COLUMN IF NOT EXISTS source_url text;
