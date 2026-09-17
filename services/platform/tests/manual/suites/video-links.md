# Video-link ingestion

> **Prefix** `VID-` · **Reset** none · **Cost** 12 boxes

Pasting a supported video URL into the chat composer starts ingestion and
shows an attachment chip. Typing the same URL leaves ordinary message text;
use an actual clipboard paste for the ingestion checks. Captions are preferred,
with audio transcription as the fallback. The current pipeline is hosted by
the Postgres backend; no Convex CLI or Convex credentials are required.

## Scope & routes

| Surface | Route |
| --- | --- |
| Chat composer and chips | `/dashboard/{org}/chat` |
| Existing conversation | `/dashboard/{org}/chat/{threadId}` |
| Job observations | Browser requests under `/api/app/video-links` and backend worker logs |

## Preconditions

Bring the stack up per [setup.md](../setup.md) — **mode B** for cases that
run the real pipeline. The backend needs `yt-dlp` and `ffmpeg` on its PATH or
in `VIDEO_INGEST_BIN_DIR`, plus outbound network access. Use a disposable
local organization and chat. Changes to provider or anti-bot configuration
belong only on that test deployment.

Have a public YouTube URL with captions, one without captions, and a playlist
URL. Caption-less ingestion requires a transcription-capable provider. A
bot wall or missing provider is a recorded environment limitation, not a
successful transcript test. Do not substitute typed text or an API write for
the paste action.

Observe the chip and the page's own job reads. Non-terminal states include
`queued`, `retrying`, `fetching_metadata`, `fetching_captions`,
`extracting_audio`, `transcribing_handoff`, and `indexing`. The visible terminal
states are completed, failed, or removed. Use worker logs to distinguish
provider/configuration refusals from browser failures.

## Functional tests

- [ ] `VID-F1` · **Paste creates a chip** — In the chat composer, type a
  supported video URL, clear it, then paste the same URL from the clipboard
  → Typing leaves plain text; pasting starts ingestion and shows a named
  chip with processing status. The pasted URL remains in the field until
  sending, when its transcript attachment represents it.
- [ ] `VID-F2` · **Caption ingestion** — Paste the captioned URL and wait for
  the chip to settle → The job completes with `transcriptSource` equal to
  `captions_human` or `captions_auto`; sending a question includes the
  transcript attachment. Verify the reply against the source captions.
- [ ] `VID-F3` · **Transcription fallback** — Repeat VID-F2 with the
  caption-less URL and a configured transcription provider → The job passes
  through audio extraction and transcription, then completes with
  `transcriptSource: whisper`. Missing configuration is explained by the
  failure detail and is not counted as a successful fallback.
- [ ] `VID-F4` · **URL deduplication** — In an existing chat, paste the same
  URL twice before sending → One unsent attachment represents the URL; the
  backend does not start a second job for the same unbound URL in that chat.
- [ ] `VID-F5` · **Playlist rejection** — Paste a playlist URL → The UI
  explains that playlists are unsupported; no usable transcript attachment
  appears and no playlist is downloaded.
- [ ] `VID-F6` · **Anti-bot configuration** — On a local test deployment where
  VID-F2 fails with `botDetection`, configure an authorized
  `VIDEO_INGEST_PROXY_URL`, `VIDEO_INGEST_POT_PROVIDER_URL`, or
  `VIDEO_INGEST_COOKIES_FILE`, restart the backend, then retry → Record whether
  the job completes. A remaining bot wall stays an environment limitation;
  configuration alone is not proof of success.
- [ ] `VID-F7` · **Gated live yt-dlp suite** — Run
  `YOUTUBE_LIVE_TEST=1 bunx vitest --run --project server backend/core/video_links/ytdlp_live.test.ts`
  from `services/platform` with network access → The suite retrieves real
  metadata and a non-empty transcript, or explicitly skips a bot-wall/rate-limit
  outcome. Other failures are investigated as regressions.

## Boundary & error tests

- [ ] `VID-B1` · **Bot wall recovery** — Run VID-F2 from a blocked test egress
  without mitigation → The job fails with `botDetection` without automatic
  retry storms. **Try again** requests one manual retry; **Remove** clears
  the failed attachment so another message can be sent.
- [ ] `VID-B2` · **Invalid proxy value** — On the local test deployment, set
  `VIDEO_INGEST_PROXY_URL=not-a-url`, restart, and repeat VID-F2 → Logs contain
  a redacted invalid-URL warning; ingestion behaves as if the invalid value
  were absent, without crashing the worker. Restore the prior environment.
- [ ] `VID-B3` · **Secret hygiene in logs** — On the local test deployment,
  use a synthetic proxy credential and trigger a failure → Worker logs and
  visible technical details reveal neither the raw credential nor cookie
  contents. Restore the prior environment.

## Accessibility (WCAG 2.1 AA)

- [ ] `VID-A1` · **Chip controls** — After VID-F1, use Tab to reach the chip's
  source, retry when failed, and remove controls → Every control has an
  accessible name and visible focus; Enter or Space activates the relevant
  action without sending the message accidentally.

## Performance

- [ ] `VID-P1` · **Caption ingestion progress** — Repeat VID-F2 on a healthy
  test egress → Progress remains visible until a terminal state. Record the
  duration; a job that stops progressing is diagnosed from its worker logs
  and watchdog state rather than assumed complete after a fixed wait.
