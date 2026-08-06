# Video-link ingestion — Manual Test Plan

> **Purpose**: The chat video-link chip UI was **removed** in #2857 (the chip
> component, its composer hook, the `videoLink` error/status strings, and the
> user docs in #2877) — pasting a video URL in chat no longer triggers
> ingestion and renders no chip. The backend pipeline is fully alive:
> `video_links/mutations:ingestVideoUrl` → the orchestrator action in
> `convex/video_links/ingest_video_link.ts` (yt-dlp captions, else
> audio → Whisper) → a synthetic `fileMetadata` transcript row, with a
> bot-wall classifier, never-retry logic, and the `VIDEO_INGEST_*` anti-bot
> env vars. This plan covers that pipeline as a backend-observable surface:
> drive it via the Convex CLI and the gated live test, observe via job rows
> and backend logs. (The one surviving i18n key,
> `chat.videoLink.statuses.attemptNumber`, has no consumer — it feeds a
> status view only the deleted UI read.)

## Scope & routes

| Surface                   | Route                             |
| ------------------------- | --------------------------------- |
| Chat (removal check only) | `/dashboard/{org}/chat`           |
| Pipeline (no UI)          | Convex CLI + `videoLinkJobs` rows |

## Prerequisites

Bring the stack up per [SETUP.md](SETUP.md) — **mode B** for every case that
runs the real pipeline (the mutation checks rate-limit/budget locally, but the
orchestrator shells out to `yt-dlp` + `ffmpeg` and needs outbound network).
The binaries must be on the backend host's PATH or pointed at via
`VIDEO_INGEST_BIN_DIR` (the shipped container image bundles them). Bot-wall
behaviour depends on the egress IP: a residential laptop usually passes, a
datacenter host reproduces the wall.

There is no UI entry point. Drive the pipeline with the Convex CLI against the
local self-hosted backend (which lets `convex run` call public functions with
a `--identity` and internal functions with the admin key from
`.convex/local/default/config.json`). Find your ids first — your `userId` and
`organizationId` are on your row in the `memberMirror` table
(`bunx convex data memberMirror`); a thread id is the last segment of
`/dashboard/{org}/chat/{threadId}` after you open any of your chat threads.

```bash
cd services/platform
bunx convex run video_links/mutations:ingestVideoUrl \
  --identity '{"subject":"<USER-ID>"}' \
  '{"organizationId":"<ORG-ID>","threadId":"<THREAD-ID>","url":"<VIDEO-URL>","pastedToken":"<VIDEO-URL>","normalizedUrl":"<VIDEO-URL>","sourcePlatform":"youtube"}'
# observe: bunx convex data videoLinkJobs
```

(`normalizedUrl`/`sourcePlatform` are required args but re-derived
server-side; passing the URL again is fine. Omitting `threadId` is allowed —
welcome-page path — but skips the dedup match F4 needs.)

Have ready: a public YouTube URL **with** captions, one **without** captions
(forces the Whisper path), and a playlist URL.

> **Agent note**: the `videoLinkJobs` row is the source of truth — poll
> `bunx convex data videoLinkJobs` (or watch
> `video_links/internal_queries:getJobById`) and drive on `status`, not
> wall-clock. Non-terminal: `queued`, `fetching_metadata`,
> `fetching_captions`, `extracting_audio`, `transcribing_handoff`,
> `indexing`. Terminal: `completed`, `failed`, `skipped`. `botDetection` /
> `rateLimited` failures are never-retried, so those rows settle fast.

## Automated coverage

| Case(s) | Status         | Test                                                                                                                                                          |
| ------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1, F4  | ⛔ manual-only | —                                                                                                                                                             |
| F2, F3  | 🔶 partial     | components only: `convex/video_links/captions_parser.test.ts`, `url_safety.test.ts`, `synthetic_file_metadata.test.ts`, `donor_reuse.test.ts`; no e2e job run |
| F5      | 🔶 partial     | `lib/shared/video-url.test.ts` (playlist detection); the ConvexError surface is manual                                                                        |
| F6, F7  | 🔶 partial     | `convex/video_links/ytdlp_live.test.ts` — gated `YOUTUBE_LIVE_TEST=1` (the CI Unit job in `.github/workflows/test.yml` runs it from a datacenter IP)          |
| B1–B3   | 🔶 partial     | `convex/video_links/ytdlp.test.ts` (stderr classifier, env-flag builders, log sanitizer); the live job-row/log behaviour is manual                            |

Legend: ✅ fully automated · 🔶 partially automated · ⛔ manual-only.

## Functional tests

| ID  | Test                     | Steps (route + control)                                                                                                                                                                                                                                        | Expected (verifiable)                                                                                                                                                                                                                     |
| --- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Chip removal is complete | In `/dashboard/{org}/chat`, paste a YouTube URL into the chat input and send. Works in mode A.                                                                                                                                                                 | The URL sends as plain message text — no chip, no progress UI, no toast. `bunx convex data videoLinkJobs` shows **no** new row (the frontend no longer calls the mutation).                                                               |
| F2  | CLI ingestion, captions  | Run the Prerequisites recipe with the **captioned** URL. _(mode B + network + yt-dlp/ffmpeg)_                                                                                                                                                                  | Returns a job id. The row advances `queued` → `fetching_metadata` → `fetching_captions` → `indexing` → **`completed`**; `transcriptSource` is `captions_human` or `captions_auto`; `fileMetadataId` points at a synthetic transcript row. |
| F3  | Whisper fallback         | Re-run F2 with the **caption-less** URL. _(ENVIRONMENT: also needs a transcription-capable provider configured)_                                                                                                                                               | Row goes through `extracting_audio` → `transcribing_handoff` (the `progress` field heartbeats, e.g. chunk counts) → **`completed`** with `transcriptSource: whisper`.                                                                     |
| F4  | URL-hash dedup           | Immediately re-run the exact F2 command (same URL, same `threadId`, same identity).                                                                                                                                                                            | The **same** job id is returned; `bunx convex data videoLinkJobs` shows no second row for that URL. (Dedup is scoped to unbound same-thread rows ≤24 h; omitting `threadId` intentionally skips it.)                                      |
| F5  | Playlist rejection       | Run F2 with a playlist URL (e.g. a `playlist?list=` URL). No network needed.                                                                                                                                                                                   | The mutation throws a ConvexError with code `playlist` ("Playlist URLs are not supported…"); no row is inserted.                                                                                                                          |
| F6  | Anti-bot env mitigation  | _(ENVIRONMENT: needs a datacenter egress where F2 fails with `botDetection`, plus a mitigation.)_ Set `VIDEO_INGEST_PROXY_URL=socks5h://…` (or `VIDEO_INGEST_POT_PROVIDER_URL`, or `VIDEO_INGEST_COOKIES_FILE`) on the backend process, restart it, re-run F2. | The job now reaches **`completed`** instead of failing with `errorReasonCode: botDetection`. Backend logs show the mitigation applied with values redacted (see B3).                                                                      |
| F7  | Gated live yt-dlp suite  | `cd services/platform && YOUTUBE_LIVE_TEST=1 bunx vitest --run --project server convex/video_links/ytdlp_live.test.ts` _(network; self-provisions yt-dlp/deno/ffmpeg into a per-user cache)_                                                                   | The suite passes: real yt-dlp pulls metadata + a non-empty transcript with the shipped anti-bot flags. A bot-wall/rate-limit outcome self-**skips** (logged) — any other failure is a real regression.                                    |

## Boundary & error tests

| ID  | Test                      | Input                                                                                                | Expected                                                                                                                                                                                                                               |
| --- | ------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Bot wall is never-retried | Run F2 from a flagged/datacenter egress with **no** mitigation env vars.                             | The row reaches **`failed`** with `errorReasonCode: botDetection` after a single attempt (`attempts: 1`) — no retry storm in the backend logs. `video_links/mutations:retryVideoLink` (same `--identity`) re-queues it once, manually. |
| B2  | Invalid proxy value       | Set `VIDEO_INGEST_PROXY_URL=not-a-url`, restart the backend, run F2.                                 | The value is ignored with a redacted console warning in the backend logs (`[ytdlp] VIDEO_INGEST_PROXY_URL is not a valid URL; ignoring`); ingestion proceeds exactly as if unset — no crash.                                           |
| B3  | Secret hygiene in logs    | Set a proxy URL with inline credentials (`socks5h://user:pass@host`), trigger any failure (e.g. B1). | Backend logs and the row's `errorMessage` never contain `user`/`pass`, the raw proxy URL, or cookie contents — the stderr sanitizer redacts URLs, `--proxy`, `--cookies`, and credential fields.                                       |

## Accessibility (WCAG 2.1 AA)

| ID  | Check               | Expected                                                                                                                                           |
| --- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | No orphaned chip UI | After F1, the chat composer contains no leftover unlabeled chip/retry controls — the pipeline has no user-facing surface, so nothing else applies. |

## Performance

| ID  | Metric                  | Target                                                                                                                                                           |
| --- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Captions ingestion (F2) | Reaches **`completed`** within a few minutes on an unflagged egress, and the every-5-min watchdog cron ("recover stuck video-link jobs") never reclaims the row. |

## Issues Found

| #   | Test ID | Route / URL | Severity (crit/high/med/low) | Description | Screenshot |
| --- | ------- | ----------- | ---------------------------- | ----------- | ---------- |
|     |         |             |                              |             |            |

## Test summary

```
Area: Video-link ingestion (backend pipeline)
Functional: ___/7   Boundary: ___/3   A11y: ___/1   Perf: ___/1
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
