# Video-link ingestion — boxes a spec took over

Rows for [`video-links`](../../suites/video-links.md) boxes that moved out of the suite. Read
[`../automation.md`](../automation.md) for the rest of the coverage map.

| Suite | Automated slice | Coverage | Specs |
| --- | --- | --- | --- |
| [video-links](../../suites/video-links.md) | Video ingest's exhausted organization upload allowance answers 429 with `Retry-After` and `RATE_LIMITED` retry metadata without inserting or queuing work. Auth/thread/body/domain/fault controls preserve status and guard order. The caller shows translated EN/DE/FR guidance with a rounded-up delay, stops a rate-limited multi-link paste after one toast, and keeps earlier successes; unrelated refusals still allow later links. Real routes/service/limiter over synthetic SQL and the real hook/toaster over stubbed HTTP; no PostgreSQL concurrency or live provider claim | ✅ route + unit + UI | `backend/domains/video_links/routes.rate-limit.test.ts`; `app/features/chat/hooks/use-chat-video-links.test.tsx` |
| [video-links](../../suites/video-links.md) | A yt-dlp run's `--proxy`: `VIDEO_INGEST_PROXY_URL` when it is valid, else the next outbound proxy of `OUTBOUND_PROXY_URLS` (an invalid override is ignored with a warning and the rotation carries the run), else none; a run whose stderr shows its pooled proxy failing (unreachable, tunnel or credentials refused) passes that proxy over for a minute, through a stand-in yt-dlp spawned on `VIDEO_INGEST_BIN_DIR` | ✅ unit + real spawn of a stand-in binary | `backend/core/video_links/ytdlp.test.ts` |
